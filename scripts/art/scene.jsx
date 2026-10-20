// The backdrop for wispy's README art: soft clouds, full screen. It is the "wallpaper" the real UI is photographed on.
// URL options: t (which patch of sky), night=1 (dusk clouds for the dark theme), bg=gradient (a ShaderGradient instead;
// then c1/c2/c3 are its colours, b its brightness).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react';

const p = new URLSearchParams(location.search);
const t = parseFloat(p.get('t') || '1.2');
const root = document.getElementById('root');

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FRAG = `precision highp float;
uniform vec2 r; uniform float t; uniform float night;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<7;i++){s+=a*n(p);p=p*2.03+vec2(17.,9.);a*=.5;}return s;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;
  vec2 p=vec2(uv.x*r.x/r.y,uv.y)*1.7+vec2(t*1.3,t*.45);
  vec2 q=vec2(fbm(p),fbm(p+vec2(5.2,1.3)));
  float c=fbm(p+1.7*q);
  float d=fbm(p+1.7*q+vec2(.05,.09));
  float cl=smoothstep(.33,.72,c);
  float shade=clamp((c-d)*5.,0.,1.);
  vec3 skyTop=mix(vec3(.66,.77,.92),vec3(.10,.14,.27),night);
  vec3 skyLow=mix(vec3(.90,.94,.985),vec3(.30,.36,.52),night);
  vec3 sky=mix(skyLow,skyTop,smoothstep(.0,1.,uv.y));
  vec3 lit=mix(vec3(1.,1.,1.),vec3(.78,.82,.92),night);
  vec3 dim=mix(vec3(.70,.76,.88),vec3(.40,.45,.60),night);
  vec3 col=mix(sky,mix(lit,dim,shade*.8),cl);
  col+=(h(gl_FragCoord.xy)-.5)*.012;
  gl_FragColor=vec4(col,1.);
}`;

function clouds() {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  root.appendChild(cv);
  const gl = cv.getContext('webgl', { preserveDrawingBuffer: true });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, cv.width, cv.height);
  gl.uniform2f(gl.getUniformLocation(pr, 'r'), cv.width, cv.height);
  gl.uniform1f(gl.getUniformLocation(pr, 't'), t);
  gl.uniform1f(gl.getUniformLocation(pr, 'night'), p.get('night') === '1' ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

if (p.get('bg') === 'gradient') {
  const url = 'https://www.shadergradient.co/customize?' + new URLSearchParams({
    animate: 'off', axesHelper: 'off', brightness: p.get('b') || '1.1', cAzimuthAngle: '180', cDistance: '3.4',
    cPolarAngle: '90', cameraZoom: '1', color1: p.get('c1') || '#ffffff', color2: p.get('c2') || '#d9e4f1', color3: p.get('c3') || '#8aa4c6',
    destination: 'onCanvas', embedMode: 'off', envPreset: 'city', fov: '45', gizmoHelper: 'hide', grain: 'off', lightType: '3d',
    pixelDensity: '2', positionX: '-1.4', positionY: '0', positionZ: '0', range: 'disabled', rangeEnd: '40', rangeStart: '0',
    reflection: '0.1', rotationX: '0', rotationY: '10', rotationZ: '50', shader: 'defaults', type: 'plane',
    uDensity: '1.3', uFrequency: '5.5', uSpeed: '0.4', uStrength: '4', uTime: String(t), wireframe: 'false'
  }).toString();
  createRoot(root).render(
    <ShaderGradientCanvas style={{ position: 'fixed', inset: 0 }} pixelDensity={2} fov={45} pointerEvents="none">
      <ShaderGradient control="query" urlString={url} />
    </ShaderGradientCanvas>
  );
} else {
  clouds();
}
