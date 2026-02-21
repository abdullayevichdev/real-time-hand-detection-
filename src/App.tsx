/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Hands, Results, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Sparkles, Trash2, Info } from 'lucide-react';

export default function App() {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  
  // Use Ref for voxels to avoid React state lag and stale closures
  const voxelsRef = useRef<Set<string>>(new Set());
  const gridSize = 40; // Increased size for larger voxels as requested

  // Grabbing State
  const fistStartTimeRef = useRef<number | null>(null);
  const isGrabbingRef = useRef(false);
  const lastHandPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      },
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    hands.onResults(onResults);

    if (webcamRef.current && webcamRef.current.video) {
      const camera = new Camera(webcamRef.current.video, {
        onFrame: async () => {
          if (webcamRef.current?.video) {
            await hands.send({ image: webcamRef.current.video });
          }
        },
        width: 1280,
        height: 720,
      });
      camera.start();
    }

    return () => {
      hands.close();
    };
  }, []);

  const getDistance = (p1: any, p2: any) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  const onResults = (results: Results) => {
    if (isLoading) setIsLoading(false);
    
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    
    const canvasCtx = canvasElement.getContext('2d');
    if (!canvasCtx) return;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // 1. Draw Existing Voxels
    canvasCtx.shadowBlur = 15;
    canvasCtx.shadowColor = '#00ffff';

    voxelsRef.current.forEach((voxelKey) => {
      const [gx, gy] = voxelKey.split(',').map(Number);
      const x = gx * gridSize;
      const y = gy * gridSize;
      
      canvasCtx.fillStyle = 'rgba(0, 255, 255, 0.5)';
      canvasCtx.fillRect(x, y, gridSize - 1, gridSize - 1);
      
      canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      canvasCtx.lineWidth = 0.5;
      canvasCtx.strokeRect(x, y, gridSize - 1, gridSize - 1);
    });

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      results.multiHandLandmarks.forEach((landmarks) => {
        // 2. Coordinate Mapping (Handle Mirroring)
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const ringTip = landmarks[16];
        const pinkyTip = landmarks[20];
        const wrist = landmarks[0];
        
        // Flip X coordinate for drawing to match mirrored video
        const mappedX = (1 - indexTip.x) * canvasElement.width;
        const mappedY = indexTip.y * canvasElement.height;
        const mappedWristX = (1 - wrist.x) * canvasElement.width;
        const mappedWristY = wrist.y * canvasElement.height;

        // 3. Gesture Detection
        
        // Pinch (Drawing)
        const dist = Math.sqrt(
          Math.pow(thumbTip.x - indexTip.x, 2) + 
          Math.pow(thumbTip.y - indexTip.y, 2)
        );
        const isPinching = dist < 0.04;

        // Fist (Grabbing)
        const fingerDists = [
          getDistance(indexTip, wrist),
          getDistance(middleTip, wrist),
          getDistance(ringTip, wrist),
          getDistance(pinkyTip, wrist)
        ];
        const isFist = fingerDists.every(d => d < 0.15);

        // 4. Logic
        if (isFist) {
          if (!fistStartTimeRef.current) {
            fistStartTimeRef.current = Date.now();
          } else if (Date.now() - fistStartTimeRef.current > 1000) {
            isGrabbingRef.current = true;
          }
        } else {
          fistStartTimeRef.current = null;
          isGrabbingRef.current = false;
          lastHandPosRef.current = null;
        }

        if (isGrabbingRef.current) {
          // Move all voxels based on wrist movement
          const currentHandPos = { x: mappedWristX, y: mappedWristY };
          
          if (lastHandPosRef.current) {
            const dx = currentHandPos.x - lastHandPosRef.current.x;
            const dy = currentHandPos.y - lastHandPosRef.current.y;
            
            if (Math.abs(dx) > gridSize || Math.abs(dy) > gridSize) {
              const shiftX = Math.round(dx / gridSize);
              const shiftY = Math.round(dy / gridSize);
              
              if (shiftX !== 0 || shiftY !== 0) {
                const newVoxels = new Set<string>();
                voxelsRef.current.forEach(key => {
                  const [gx, gy] = key.split(',').map(Number);
                  newVoxels.add(`${gx + shiftX},${gy + shiftY}`);
                });
                voxelsRef.current = newVoxels;
                lastHandPosRef.current = currentHandPos;
              }
            }
          } else {
            lastHandPosRef.current = currentHandPos;
          }

          // Visual feedback for grabbing
          canvasCtx.beginPath();
          canvasCtx.arc(mappedWristX, mappedWristY, 40, 0, Math.PI * 2);
          canvasCtx.strokeStyle = '#00ff00';
          canvasCtx.lineWidth = 5;
          canvasCtx.shadowBlur = 30;
          canvasCtx.shadowColor = '#00ff00';
          canvasCtx.stroke();
        } else if (isPinching) {
          const gx = Math.floor(mappedX / gridSize);
          const gy = Math.floor(mappedY / gridSize);
          const key = `${gx},${gy}`;
          voxelsRef.current.add(key);

          // Draw Cursor Circle
          canvasCtx.beginPath();
          canvasCtx.arc(mappedX, mappedY, 12, 0, Math.PI * 2);
          canvasCtx.strokeStyle = '#fff';
          canvasCtx.lineWidth = 3;
          canvasCtx.shadowBlur = 20;
          canvasCtx.shadowColor = '#ffff00';
          canvasCtx.stroke();
        }

        // 5. Draw Hand Landmarks
        drawConnectors(canvasCtx, landmarks.map(l => ({...l, x: 1 - l.x})), HAND_CONNECTIONS, {
          color: isGrabbingRef.current ? 'rgba(0, 255, 0, 0.4)' : 'rgba(255, 255, 255, 0.2)',
          lineWidth: 1,
        });
        
        landmarks.forEach(p => {
          canvasCtx.beginPath();
          canvasCtx.arc((1 - p.x) * canvasElement.width, p.y * canvasElement.height, 3, 0, Math.PI * 2);
          canvasCtx.fillStyle = isGrabbingRef.current ? '#00ff00' : '#ff0000';
          canvasCtx.shadowBlur = 5;
          canvasCtx.shadowColor = isGrabbingRef.current ? '#00ff00' : '#ff0000';
          canvasCtx.fill();
        });
      });
    }
    canvasCtx.restore();
  };

  const clearCanvas = () => {
    voxelsRef.current.clear();
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans">
      {/* Background Atmosphere */}
      <div className="absolute inset-0 z-0 opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 blur-[150px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-500/10 blur-[150px] rounded-full" />
      </div>

      {/* Main Viewport */}
      <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
        <div className="relative w-full max-w-6xl aspect-video bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          
          {/* Webcam Feed */}
          <Webcam
            ref={webcamRef}
            mirrored
            audio={false}
            disablePictureInPicture={true}
            forceScreenshotSourceSize={false}
            imageSmoothing={true}
            onUserMediaError={() => {}}
            onUserMedia={() => setIsCameraReady(true)}
            screenshotFormat="image/webp"
            screenshotQuality={0.92}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
            videoConstraints={{
              width: 1280,
              height: 720,
              facingMode: 'user',
            }}
          />

          {/* Drawing Canvas - NOT mirrored by CSS, we handle it in code */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full z-20 pointer-events-none"
            width={1280}
            height={720}
          />

          {/* Loading Overlay */}
          <AnimatePresence>
            {(isLoading || !isCameraReady) && (
              <motion.div
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center gap-6"
              >
                <Loader2 className="w-16 h-16 text-cyan-400 animate-spin" />
                <p className="text-cyan-100 font-bold tracking-widest uppercase text-xs">
                  Initializing Voxel Engine...
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* UI Elements */}
          <div className="absolute top-8 left-8 z-30 flex items-center gap-4">
            <div className="p-3 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10">
              <Sparkles className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-white font-black tracking-tighter text-2xl italic uppercase">Voxel Draw</h1>
              <p className="text-cyan-400/70 text-[10px] uppercase tracking-widest font-bold">Spatial Interface</p>
            </div>
          </div>

          <div className="absolute bottom-8 right-8 z-30 flex gap-3">
            <button 
              onClick={clearCanvas}
              className="p-4 bg-red-500/20 hover:bg-red-500/40 text-red-400 backdrop-blur-xl rounded-2xl border border-red-500/20 transition-all"
              title="Clear All"
            >
              <Trash2 className="w-6 h-6" />
            </button>
            <button 
              onClick={() => setShowInfo(!showInfo)}
              className="p-4 bg-white/5 hover:bg-white/10 text-white backdrop-blur-xl rounded-2xl border border-white/10 transition-all"
            >
              <Info className="w-6 h-6" />
            </button>
          </div>

          {/* Info Modal */}
          <AnimatePresence>
            {showInfo && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute inset-0 z-40 flex items-center justify-center p-6"
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowInfo(false)} />
                <div className="relative max-w-sm w-full p-8 bg-zinc-900/90 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-2xl text-center">
                  <h3 className="text-xl font-black text-white mb-4 italic uppercase tracking-wider">How to Draw</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                    Pinch your <span className="text-cyan-400 font-bold">Thumb</span> and <span className="text-cyan-400 font-bold">Index finger</span> together to place neon voxels in the air.
                  </p>
                  <button 
                    onClick={() => setShowInfo(false)}
                    className="w-full py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-black uppercase tracking-widest rounded-2xl transition-all"
                  >
                    Start Drawing
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="absolute bottom-6 left-0 right-0 z-10 text-center">
        <p className="text-white/20 text-[9px] uppercase tracking-[0.5em] font-bold">
          Spatial Voxel Interface v1.0
        </p>
      </div>
    </div>
  );
}
