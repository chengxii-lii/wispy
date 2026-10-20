// The backdrop for tinybar's README art: a ShaderGradient (shadergradient.co), full screen. It is the "wallpaper"
// the real UI is photographed on. URL options: t (moment in the animation), c1/c2/c3 (colours), b (brightness),
// grain=off, d (camera distance), s (wave strength), type (plane | waterPlane | sphere).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react';

const p = new URLSearchParams(location.search);
const t = p.get('t') || '1.2';
// Midnight blue with tinybar's cyan accent running through it.
const url = 'https://www.shadergradient.co/customize?' + new URLSearchParams({
  animate: 'off', axesHelper: 'off', brightness: p.get('br') || '0.95', cAzimuthAngle: '180', cDistance: p.get('d') || '3.4',
  cPolarAngle: '90', cameraZoom: '1', color1: p.get('c1') || '#2547c9', color2: p.get('c2') || '#6bbcff', color3: p.get('c3') || '#070b2c',
  destination: 'onCanvas', embedMode: 'off', envPreset: 'city', fov: '45', gizmoHelper: 'hide', grain: p.get('grain') || 'on', lightType: '3d',
  pixelDensity: '2', positionX: '-1.4', positionY: '0', positionZ: '0', range: 'disabled', rangeEnd: '40', rangeStart: '0',
  reflection: '0.1', rotationX: '0', rotationY: '10', rotationZ: '50', shader: 'defaults', type: p.get('type') || 'plane',
  uDensity: '1.3', uFrequency: '5.5', uSpeed: '0.4', uStrength: p.get('s') || '4', uTime: t, wireframe: 'false'
}).toString();

createRoot(document.getElementById('root')).render(
  <ShaderGradientCanvas style={{ position: 'fixed', inset: 0 }} pixelDensity={2} fov={45} pointerEvents="none">
    <ShaderGradient control="query" urlString={url} />
  </ShaderGradientCanvas>
);
