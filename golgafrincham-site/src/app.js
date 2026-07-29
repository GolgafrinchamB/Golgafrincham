/* Earth Orbit Catalog — SGP4 tracker for the full CelesTrak active TLE set. */
(function(){
'use strict';
const $ = id => document.getElementById(id);
const RE = 6371.0;               // km per render unit
const MU = 398600.4418;          // km^3/s^2
const DEG = 180/Math.PI;

/* ---------- categories ---------- */
const CATS = [
  {key:'sta', name:'STATIONS',        color:0xffffff},
  {key:'nav', name:'NAVIGATION',      color:0xffcf6b},
  {key:'sci', name:'SCIENCE',         color:0xb98af0},
  {key:'wea', name:'WEATHER / EO',    color:0x63c76a},
  {key:'mil', name:'MILITARY',        color:0xef6b5e},
  {key:'stl', name:'STARLINK',        color:0x4d6a86},
  {key:'meg', name:'OTHER CONSTEL.',  color:0x3f948d},
  {key:'oth', name:'OTHER',           color:0x7d93a8},
];
const CAT_INDEX = {}; CATS.forEach((c,i)=>CAT_INDEX[c.key]=i);
const tagSets = {};
for (const k in TAGS) tagSets[k] = new Set(TAGS[k]);
const MEGA_RE = /^(ONEWEB|KUIPER|QIANFAN|HULIANWANG)/;

function categorize(norad, name){
  if (tagSets.sta.has(norad)) return CAT_INDEX.sta;
  if (tagSets.gps.has(norad) || tagSets.glo.has(norad) ||
      tagSets.gal.has(norad) || tagSets.bei.has(norad)) return CAT_INDEX.nav;
  if (tagSets.sci.has(norad)) return CAT_INDEX.sci;
  if (tagSets.wea.has(norad) || tagSets.eo.has(norad)) return CAT_INDEX.wea;
  if (tagSets.mil.has(norad)) return CAT_INDEX.mil;
  if (name.startsWith('STARLINK')) return CAT_INDEX.stl;
  if (MEGA_RE.test(name)) return CAT_INDEX.meg;
  return CAT_INDEX.oth;
}
function navSystem(norad){
  if (tagSets.gps.has(norad)) return 'GPS';
  if (tagSets.glo.has(norad)) return 'GLONASS';
  if (tagSets.gal.has(norad)) return 'GALILEO';
  if (tagSets.bei.has(norad)) return 'BEIDOU';
  return null;
}

/* ---------- TLE parsing ---------- */
function parse3LE(text){
  const lines = text.split('\n').map(l=>l.replace(/\r$/,'')).filter(l=>l.trim().length>0);
  const out = [];
  let pending = null;
  for (let i=0;i<lines.length;i++){
    const l = lines[i];
    if (l.startsWith('1 ') && l.length>=69){
      const l2 = lines[i+1];
      if (l2 && l2.startsWith('2 ') && l2.length>=69){
        out.push({name:(pending||('NORAD '+l.substring(2,7).trim())).trim(), l1:l, l2:l2});
        i++; pending=null;
      }
    } else if (!l.startsWith('2 ')) {
      pending = l.replace(/^0 /,'');
    }
  }
  return out;
}

/* ---------- catalog state ---------- */
let N=0, names=[], norads=[], intl=[], satrecs=[], cats=null, regimes=[],
    periodMin=null, inclDeg=null, eccArr=null, epochAge=null,
    posLive=null, axisArr=null, omgArr=null, alive=null, catVisible=null,
    lowerNames=[], noradStr=[];
const catOn = new Array(CATS.length).fill(true);
let sel = -1;

function regimeOf(pMin, e){
  if (e > 0.25) return 'HEO';
  if (pMin < 128) return 'LEO';
  if (pMin < 1300) return 'MEO';
  if (pMin < 1600) return 'GEO';
  return 'HIGH';
}

function buildCatalog(records, onProgress, onDone){
  N = records.length;
  names=new Array(N); norads=new Array(N); intl=new Array(N); satrecs=new Array(N);
  regimes=new Array(N); lowerNames=new Array(N); noradStr=new Array(N);
  cats=new Uint8Array(N); periodMin=new Float32Array(N); inclDeg=new Float32Array(N);
  eccArr=new Float32Array(N); epochAge=new Float32Array(N);
  posLive=new Float32Array(3*N); axisArr=new Float32Array(3*N); omgArr=new Float32Array(N);
  alive=new Uint8Array(N); catVisible=new Uint8Array(N);
  const nowMs = Date.now();
  let i = 0;
  function chunk(){
    const end = Math.min(N, i+1500);
    for (; i<end; i++){
      const r = records[i];
      const sr = satellite.twoline2satrec(r.l1, r.l2);
      const norad = parseInt(r.l1.substring(2,7).trim(),10) || 0;
      names[i]=r.name; norads[i]=norad; noradStr[i]=String(norad);
      lowerNames[i]=r.name.toLowerCase();
      intl[i]=r.l1.substring(9,17).trim();
      satrecs[i]=sr;
      const p = 2*Math.PI/sr.no;                     // minutes
      periodMin[i]=p; inclDeg[i]=sr.inclo*DEG; eccArr[i]=sr.ecco;
      regimes[i]=regimeOf(p, sr.ecco);
      cats[i]=categorize(norad, r.name);
      const yy = sr.epochyr<57 ? 2000+sr.epochyr : 1900+sr.epochyr;
      const epochMs = Date.UTC(yy,0,1) + (sr.epochdays-1)*86400000;
      epochAge[i]=(nowMs-epochMs)/86400000;
      alive[i]=(sr.error===0)?1:0;
    }
    onProgress(i, N);
    if (i < N) setTimeout(chunk, 0); else onDone();
  }
  chunk();
}

/* ---------- three.js scene ---------- */
let renderer, scene, camera, earthGroup, satPoints, satGeom, posAttr, colAttr,
    selMarker, selGeom, orbitLine, sunLight, raycaster, pr=1;

function eciToThree(x,y,z,out,o){ out[o]=y; out[o+1]=z; out[o+2]=x; }

function initScene(){
  const canvas = $('c');
  renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  pr = Math.min(window.devicePixelRatio||1, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080f);
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.05, 400);

  sunLight = new THREE.DirectionalLight(0xfff2dd, 1.15);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x2b3948, 0.85));

  earthGroup = new THREE.Group();
  scene.add(earthGroup);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    makeEarthMaterial()
  );
  earthGroup.add(globe);

  earthGroup.add(buildCoastlines());
  earthGroup.add(buildGraticule());
  scene.add(buildAtmosphere());
  scene.add(buildStars());

  // satellite point cloud placeholder; filled once catalog is built
  satGeom = new THREE.BufferGeometry();
  satGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0),3));
  const mat = new THREE.PointsMaterial({size:2.2*pr, sizeAttenuation:false,
    vertexColors:true, transparent:true, opacity:0.95, depthWrite:false});
  satPoints = new THREE.Points(satGeom, mat);
  satPoints.frustumCulled = false;
  scene.add(satPoints);

  // selection marker
  selGeom = new THREE.BufferGeometry();
  selGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3),3));
  selMarker = new THREE.Points(selGeom, new THREE.PointsMaterial({size:9*pr,
    sizeAttenuation:false, color:0xffcf6b, transparent:true, opacity:0.95, depthWrite:false}));
  selMarker.visible = false; selMarker.frustumCulled = false;
  scene.add(selMarker);

  raycaster = new THREE.Raycaster();

  window.addEventListener('resize', ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function latLonToLocal(latDeg, lonDeg, r, out, o){
  const la=latDeg/DEG, lo=lonDeg/DEG;
  const x=Math.cos(la)*Math.cos(lo), y=Math.cos(la)*Math.sin(lo), z=Math.sin(la);
  out[o]=y*r; out[o+1]=z*r; out[o+2]=x*r;    // same cyclic map as ECI
}

function buildCoastlines(){
  const segs=[]; const R=1.002;
  for (const pl of COAST_D){
    let x=pl[0], y=pl[1]; const pts=[[x/10,y/10]];
    for (let k=2;k<pl.length;k+=2){ x+=pl[k]; y+=pl[k+1]; pts.push([x/10,y/10]); }
    for (let k=0;k<pts.length-1;k++){
      const a=new Float32Array(3), b=new Float32Array(3);
      latLonToLocal(pts[k][1],pts[k][0],R,a,0);
      latLonToLocal(pts[k+1][1],pts[k+1][0],R,b,0);
      segs.push(a[0],a[1],a[2],b[0],b[1],b[2]);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs),3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({color:0xbfd3e2, transparent:true, opacity:0.16}));
}

function buildGraticule(){
  const segs=[]; const R=1.0005; const push=(a,b)=>{segs.push(a[0],a[1],a[2],b[0],b[1],b[2]);};
  const a=new Float32Array(3), b=new Float32Array(3);
  for (let lat=-60; lat<=60; lat+=30){
    for (let lon=-180; lon<180; lon+=4){
      latLonToLocal(lat,lon,R,a,0); latLonToLocal(lat,lon+4,R,b,0); push(a,b);
    }
  }
  for (let lon=-180; lon<180; lon+=30){
    for (let lat=-88; lat<88; lat+=4){
      latLonToLocal(lat,lon,R,a,0); latLonToLocal(lat+4,lon,R,b,0); push(a,b);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs),3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({color:0x8fa8bd, transparent:true, opacity:0.12}));
}

function buildAtmosphere(){
  const mat = new THREE.ShaderMaterial({
    side:THREE.BackSide, blending:THREE.AdditiveBlending, transparent:true, depthWrite:false,
    vertexShader:
      'varying vec3 vN; varying vec3 vP;'+
      'void main(){ vN = normalize(normalMatrix * normal);'+
      ' vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;'+
      ' gl_Position = projectionMatrix * mv; }',
    fragmentShader:
      'varying vec3 vN; varying vec3 vP;'+
      'void main(){ float rim = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), 3.5);'+
      ' gl_FragColor = vec4(0.30, 0.52, 0.78, 1.0) * rim * 0.9; }'
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1.045, 48, 32), mat);
}

function buildStars(){
  const n=1300, p=new Float32Array(3*n), c=new Float32Array(3*n);
  for (let i=0;i<n;i++){
    const u=Math.random()*2-1, t=Math.random()*Math.PI*2, s=Math.sqrt(1-u*u), r=120;
    p[3*i]=r*s*Math.cos(t); p[3*i+1]=r*u; p[3*i+2]=r*s*Math.sin(t);
    const b=0.35+Math.random()*0.65, tint=Math.random();
    c[3*i]=b*(tint>0.8?0.95:1); c[3*i+1]=b*0.97; c[3*i+2]=b*(tint<0.2?0.95:1.05);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p,3));
  g.setAttribute('color', new THREE.BufferAttribute(c,3));
  return new THREE.Points(g, new THREE.PointsMaterial({size:1.5*pr, sizeAttenuation:false,
    vertexColors:true, transparent:true, opacity:0.8, depthWrite:false}));
}

function initSatBuffers(){
  const posA=new Float32Array(3*N), colA=new Float32Array(3*N);
  const col=new THREE.Color();
  for (let i=0;i<N;i++){
    col.setHex(CATS[cats[i]].color);
    colA[3*i]=col.r; colA[3*i+1]=col.g; colA[3*i+2]=col.b;
  }
  posAttr=new THREE.BufferAttribute(posA,3); posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr=new THREE.BufferAttribute(colA,3);
  satGeom.setAttribute('position',posAttr);
  satGeom.setAttribute('color',colAttr);
  satGeom.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,0,0),60);
}

/* ---------- sun direction (low-precision solar ephemeris, TEME-adequate) ---------- */
let earthMat=null;
function makeEarthMaterial(){
  const ld=new THREE.TextureLoader();
  const day=ld.load(EARTH_DAY), night=ld.load(EARTH_NIGHT);
  for(const t of [day,night]){
    t.wrapS=THREE.RepeatWrapping;                 // shader shifts u by +0.25; Repeat keeps the seam invisible
    t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  }
  earthMat=new THREE.ShaderMaterial({
    uniforms:{ dayTex:{value:day}, nightTex:{value:night}, sunDir:{value:new THREE.Vector3(0,0,1)} },
    vertexShader:
      'varying vec2 vUv; varying vec3 vNw;\n'+
      'void main(){ vUv=uv; vNw=normalize(mat3(modelMatrix)*normal);\n'+
      '  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:
      'uniform sampler2D dayTex, nightTex; uniform vec3 sunDir;\n'+
      'varying vec2 vUv; varying vec3 vNw;\n'+
      'void main(){\n'+
      '  vec2 uv=vec2(vUv.x+0.25, vUv.y);\n'+          // ECEF frame: Greenwich sits a quarter turn from the UV origin
      '  vec3 day=texture2D(dayTex,uv).rgb;\n'+
      '  vec3 night=texture2D(nightTex,uv).rgb;\n'+
      '  float sd=dot(normalize(vNw), sunDir);\n'+
      '  float f=smoothstep(-0.12, 0.18, sd);\n'+
      '  vec3 nightSide=night*1.4+vec3(0.012,0.020,0.034);\n'+
      '  vec3 col=mix(nightSide, day*(0.32+0.68*clamp(sd,0.0,1.0)), f);\n'+
      '  gl_FragColor=vec4(col,1.0); }'
  });
  return earthMat;
}
function updateSun(dateMs){
  const n=(dateMs-Date.UTC(2000,0,1,12))/86400000;
  const L=(280.460+0.9856474*n)%360, g=((357.528+0.9856003*n)%360)/DEG;
  const lam=(L+1.915*Math.sin(g)+0.020*Math.sin(2*g))/DEG;
  const eps=(23.439-4e-7*n)/DEG;
  const x=Math.cos(lam), y=Math.cos(eps)*Math.sin(lam), z=Math.sin(eps)*Math.sin(lam);
  sunDir[0]=y; sunDir[1]=z; sunDir[2]=x;               // three-mapped ECI unit vector
  sunLight.position.set(y*50, z*50, x*50);
  if(earthMat) earthMat.uniforms.sunDir.value.set(sunDir[0],sunDir[1],sunDir[2]);
}

const sunDir=new Float64Array([0,0,1]);

/* ---------- camera controls ---------- */
const ctrl = {yaw:0.9, pitch:0.32, dist:3.4, tyaw:0.9, tpitch:0.32, tdist:3.4};
function applyCamera(){
  ctrl.yaw += (ctrl.tyaw-ctrl.yaw)*0.16;
  ctrl.pitch += (ctrl.tpitch-ctrl.pitch)*0.16;
  ctrl.dist += (ctrl.tdist-ctrl.dist)*0.18;
  const cp=Math.cos(ctrl.pitch), sp=Math.sin(ctrl.pitch);
  camera.position.set(ctrl.dist*cp*Math.sin(ctrl.yaw), ctrl.dist*sp, ctrl.dist*cp*Math.cos(ctrl.yaw));
  camera.lookAt(0,0,0);
}
function initControls(){
  const canvas=$('c');
  const ptrs=new Map(); let lastPinch=0, moved=0, downX=0, downY=0;
  canvas.addEventListener('pointerdown',e=>{
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    moved=0; downX=e.clientX; downY=e.clientY;
    canvas.classList.add('drag');
    if (ptrs.size===2){
      const a=[...ptrs.values()]; lastPinch=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
    }
  });
  canvas.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId)) return;
    const p=ptrs.get(e.pointerId);
    const dx=e.clientX-p.x, dy=e.clientY-p.y;
    p.x=e.clientX; p.y=e.clientY;
    moved+=Math.abs(dx)+Math.abs(dy);
    if (ptrs.size===1){
      const s=0.0038*Math.max(0.35, Math.min(1,(ctrl.dist-1)/3));
      ctrl.tyaw-=dx*s; ctrl.tpitch+=dy*s;
      ctrl.tpitch=Math.max(-1.45,Math.min(1.45,ctrl.tpitch));
    } else if (ptrs.size===2){
      const a=[...ptrs.values()];
      const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
      if (lastPinch>0) ctrl.tdist=clampDist(ctrl.tdist*(lastPinch/d));
      lastPinch=d;
    }
  });
  const up=e=>{
    if (ptrs.has(e.pointerId) && ptrs.size===1 && moved<6) pick(downX,downY);
    ptrs.delete(e.pointerId); lastPinch=0;
    if(!ptrs.size) canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup',up);
  canvas.addEventListener('pointercancel',up);
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    ctrl.tdist=clampDist(ctrl.tdist*Math.pow(1.0016,e.deltaY));
  },{passive:false});
}
function clampDist(d){ return Math.max(1.35, Math.min(60, d)); }

/* ---------- time engine ---------- */
const SPEEDS=[1,10,60,600,3600,21600];
const SPEED_LABELS=['REAL TIME','10×','60×','10 MIN / S','1 HR / S','6 HR / S'];
let spdIdx=0, paused=false, simMs=Date.now(), lastFrame=performance.now();
let gmstNow=0, burst=0;

function setSpeed(i){
  spdIdx=Math.max(0,Math.min(SPEEDS.length-1,i));
  $('speedbox').textContent=SPEED_LABELS[spdIdx];
  $('spdlabel').textContent=SPEED_LABELS[spdIdx].toLowerCase();
}
function jumpNow(){ simMs=Date.now(); burst=N; refreshOrbit(true); }

/* ---------- per-frame propagation ---------- */
let cursor=0, batch=350;
const tmpDate=new Date();
function sgp4Batch(){
  if(!N) return;
  const want = burst>0 ? Math.max(batch,2400) : batch;
  const t0=performance.now();
  tmpDate.setTime(simMs);
  let done=0;
  while(done<want){
    const i=cursor;
    cursor=(cursor+1)%N;
    done++;
    if(!alive[i]) continue;
    const pv=satellite.propagate(satrecs[i],tmpDate);
    const p=pv&&pv.position, v=pv&&pv.velocity;
    if(!p||!isFinite(p.x)||!isFinite(v.x)){ alive[i]=0; continue; }
    eciToThree(p.x/RE,p.y/RE,p.z/RE,posLive,3*i);
    // orbit-plane axis = normalize(r × v), angular rate = |v|/|r|  (circular-arc advance)
    const ax=p.y*v.z-p.z*v.y, ay=p.z*v.x-p.x*v.z, az=p.x*v.y-p.y*v.x;
    const al=Math.hypot(ax,ay,az)||1;
    eciToThree(ax/al,ay/al,az/al,axisArr,3*i);
    omgArr[i]=Math.hypot(v.x,v.y,v.z)/Math.hypot(p.x,p.y,p.z);
    if(burst>0) burst--;
  }
  const ms=performance.now()-t0;
  if(ms<4.5) batch=Math.min(3000,Math.round(batch*1.25));
  else if(ms>8) batch=Math.max(120,Math.round(batch*0.7));
}

function advanceAll(dtSimSec){
  if(!N||dtSimSec===0) return;
  for(let i=0;i<N;i++){
    if(!alive[i]) continue;
    const th=omgArr[i]*dtSimSec;
    if(th===0) continue;
    const t=Math.abs(th)>0.35 ? Math.sign(th)*0.35 : th;   // cap: SGP4 refresh catches up
    const o=3*i;
    const kx=axisArr[o],ky=axisArr[o+1],kz=axisArr[o+2];
    const vx=posLive[o],vy=posLive[o+1],vz=posLive[o+2];
    const c=Math.cos(t),s=Math.sin(t),d=(kx*vx+ky*vy+kz*vz)*(1-c);
    posLive[o]  =vx*c+(ky*vz-kz*vy)*s+kx*d;
    posLive[o+1]=vy*c+(kz*vx-kx*vz)*s+ky*d;
    posLive[o+2]=vz*c+(kx*vy-ky*vx)*s+kz*d;
  }
}

function pushPositions(){
  const a=posAttr.array;
  for(let i=0;i<N;i++){
    const o=3*i;
    if(alive[i]&&catVisible[i]){ a[o]=posLive[o]; a[o+1]=posLive[o+1]; a[o+2]=posLive[o+2]; }
    else { a[o]=0; a[o+1]=0; a[o+2]=0; }
  }
  posAttr.needsUpdate=true;
}

/* ---------- selection ---------- */
function pick(cx,cy){
  if(!N) return;
  const m=new THREE.Vector2((cx/window.innerWidth)*2-1,-(cy/window.innerHeight)*2+1);
  raycaster.setFromCamera(m,camera);
  raycaster.params.Points={threshold:0.011*ctrl.dist};
  const hits=raycaster.intersectObject(satPoints);
  const co=camera.position;
  const b0=co.dot(raycaster.ray.direction), c0=co.lengthSq()-1;
  const disc=b0*b0-c0, tEarth=disc>0?(-b0-Math.sqrt(disc)):Infinity;
  if(pickGlobeMode){
    if(isFinite(tEarth)&&tEarth>0){
      const P=raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction,tEarth);
      const w=[P.x,P.y,P.z], e=[0,0,0];
      ry(w,-gmstNow,e);                       // world ECI -> ECEF (three-mapped)
      const lat=Math.asin(Math.max(-1,Math.min(1,e[1]/Math.hypot(e[0],e[1],e[2]))))*DEG;
      let lon=Math.atan2(e[0],e[2])*DEG;
      setObserver(lat,lon);
    }
    pickGlobeMode=false; $('pickglobe').classList.remove('armed');
    return;
  }
  for(const h of hits){
    const i=h.index;
    if(!alive[i]||!catVisible[i]) continue;
    if(tEarth>0&&tEarth<h.distance-0.01) continue;   // behind the globe
    select(i); return;
  }
  select(-1);
}

function select(i){
  sel=i;
  if(i<0){ $('card').hidden=true; selMarker.visible=false; orbitClear(); return; }
  $('card').hidden=false;
  selMarker.visible=true;
  refreshOrbit(true);
  updateCard(true);
}

let orbitGenSim=0;
function orbitClear(){ if(orbitLine){ scene.remove(orbitLine); orbitLine.geometry.dispose(); orbitLine=null; } }
function refreshOrbit(force){
  if(sel<0) return;
  const p=periodMin[sel]*60000;
  if(!force && Math.abs(simMs-orbitGenSim)<p*0.2) return;
  orbitClear();
  const d=new Date(), tmp=new Float64Array(3);
  function samp(t){
    d.setTime(t);
    const pv=satellite.propagate(satrecs[sel],d);
    if(!pv||!pv.position||!isFinite(pv.position.x)) return null;
    eciToThree(pv.position.x/RE,pv.position.y/RE,pv.position.z/RE,tmp,0);
    return [tmp[0],tmp[1],tmp[2],t];
  }
  const SEED=96, THR=Math.cos(6/DEG), pts=[];
  for(let k=0;k<SEED;k++){
    const q=samp(simMs+(k/SEED)*p);
    if(!q) return;
    pts.push(q);
  }
  /* Uniform-time samples under-resolve perigee on eccentric orbits (Kepler's
     2nd law), letting straight chords cut through the globe. Subdivide any
     chord spanning >6 deg as seen from Earth's center until the line hugs
     the true path. Near-circular orbits never trigger this. */
  let guard=0;
  for(let i=0;i<pts.length&&pts.length<900&&guard<4000;i++,guard++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    const ca=(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/
      (Math.hypot(a[0],a[1],a[2])*Math.hypot(b[0],b[1],b[2]));
    if(!(ca<THR)) continue;
    let tb=b[3]; if(tb<=a[3]) tb+=p;
    const q=samp((a[3]+tb)/2);
    if(!q) return;
    pts.splice(i+1,0,q);
    i--;
  }
  const arr=new Float32Array(3*pts.length);
  for(let k=0;k<pts.length;k++){ arr[3*k]=pts[k][0]; arr[3*k+1]=pts[k][1]; arr[3*k+2]=pts[k][2]; }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(arr,3));
  orbitLine=new THREE.LineLoop(g,new THREE.LineBasicMaterial({color:0xe8a63d,transparent:true,opacity:0.75}));
  orbitLine.frustumCulled=false;
  scene.add(orbitLine);
  orbitGenSim=simMs;
}

let lastCard=0, cardMissionFor=-1;
function updateCard(force){
  if(sel<0) return;
  const t=performance.now();
  if(!force&&t-lastCard<250) return;
  lastCard=t;
  const i=sel;
  tmpDate.setTime(simMs);
  const pv=satellite.propagate(satrecs[i],tmpDate);
  if(!pv||!pv.position||!isFinite(pv.position.x)) return;
  const p=pv.position,v=pv.velocity;
  const r=Math.hypot(p.x,p.y,p.z), spd=Math.hypot(v.x,v.y,v.z);
  const g=satellite.eciToGeodetic(p,gmstNow);
  let lat=g.latitude*DEG, lon=g.longitude*DEG;
  lon=((lon+540)%360)-180;
  const catName=CATS[cats[i]].name;
  const nav=cats[i]===CAT_INDEX.nav?navSystem(norads[i]):null;
  $('cardname').textContent=names[i];
  $('cardsub').textContent='NORAD '+norads[i]+' · '+intl[i]+' · '+(nav?catName+' — '+nav:catName);
  const rows=[
    ['REGIME',regimes[i]],
    ['ALTITUDE',(r-RE).toFixed(0)+' km'],
    ['SPEED',spd.toFixed(2)+' km/s'],
    ['PERIOD',periodMin[i]>=1440?(periodMin[i]/60).toFixed(1)+' h':periodMin[i].toFixed(1)+' min'],
    ['INCLINATION',inclDeg[i].toFixed(1)+'°'],
    ['ECCENTRICITY',eccArr[i].toFixed(4)],
    ['SUBPOINT',Math.abs(lat).toFixed(1)+'°'+(lat>=0?'N':'S')+'  '+Math.abs(lon).toFixed(1)+'°'+(lon>=0?'E':'W')],
    ['ELSET AGE',epochAge[i].toFixed(1)+' d'],
  ];
  if(obs.set){
    const la=lookAngleSel(i);
    rows.push(['FROM OBSERVER', la.el>0
      ? la.el.toFixed(0)+'° '+compass(la.az)+' · '+Math.round(la.rng)+' km'+(sunlit(i)?' · SUNLIT':' · IN SHADOW')
      : 'below horizon']);
  }
  $('cardgrid').innerHTML=rows.map(r=>'<div><div class="lbl">'+r[0]+'</div><div class="v">'+r[1]+'</div></div>').join('');
  if(cardMissionFor!==i){ $('cardmission').innerHTML=missionHTML(i); cardMissionFor=i; }
  const o=3*i;
  selGeom.attributes.position.array.set([posLive[o],posLive[o+1],posLive[o+2]]);
  selGeom.attributes.position.needsUpdate=true;
}

function focusCam(i){
  const o=3*i, x=posLive[o],y=posLive[o+1],z=posLive[o+2];
  ctrl.tyaw=Math.atan2(x,z);
  ctrl.tpitch=Math.asin(Math.max(-1,Math.min(1,y/(Math.hypot(x,y,z)||1))));
  const r=Math.hypot(x,y,z);
  if(ctrl.tdist<r*1.15) ctrl.tdist=clampDist(r*1.35);
}

/* ---------- filters / search / counts ---------- */
function applyFilters(){
  for(let i=0;i<N;i++) catVisible[i]=catOn[cats[i]]?1:0;
  if(sel>=0&&!catVisible[sel]) select(-1);
  updateCounts();
}
function updateCounts(){
  let vis=0; const per=new Array(CATS.length).fill(0);
  for(let i=0;i<N;i++) if(alive[i]){ per[cats[i]]++; if(catVisible[i]) vis++; }
  $('count').textContent=vis.toLocaleString('en-US');
  document.querySelectorAll('.chip').forEach((el,ci)=>{
    el.querySelector('.ct').textContent=per[ci].toLocaleString('en-US');
  });
}
function buildChips(){
  const wrap=$('chips'); wrap.innerHTML='';
  CATS.forEach((c,ci)=>{
    const el=document.createElement('div');
    el.className='chip'; el.tabIndex=0; el.setAttribute('role','button');
    el.innerHTML='<span class="dot" style="background:#'+c.color.toString(16).padStart(6,'0')+'"></span>'+
      '<span>'+c.name+'</span><span class="ct">—</span>';
    const toggle=()=>{ catOn[ci]=!catOn[ci]; el.classList.toggle('off',!catOn[ci]); applyFilters(); };
    el.addEventListener('click',toggle);
    el.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();} });
    wrap.appendChild(el);
  });
  $('allon').addEventListener('click',()=>{ catOn.fill(true);
    document.querySelectorAll('.chip').forEach(el=>el.classList.remove('off')); applyFilters(); });
  $('alloff').addEventListener('click',()=>{ catOn.fill(false);
    document.querySelectorAll('.chip').forEach(el=>el.classList.add('off')); applyFilters(); });
}

function initSearch(){
  const inp=$('search'), res=$('results');
  let hot=-1, list=[];
  function close(){ res.classList.remove('open'); hot=-1; }
  function run(){
    const q=inp.value.trim().toLowerCase();
    if(q.length<2){ close(); return; }
    const starts=[],within=[];
    for(let i=0;i<N;i++){
      if(!alive[i]) continue;
      const nm=lowerNames[i];
      if(nm.startsWith(q)||noradStr[i]===q) starts.push(i);
      else if(nm.includes(q)||noradStr[i].startsWith(q)) within.push(i);
      if(starts.length>=14) break;
    }
    list=starts.concat(within).slice(0,14);
    if(!list.length){ close(); return; }
    res.innerHTML=list.map(i=>'<div class="res" data-i="'+i+'">'+
      '<span class="dot" style="background:#'+CATS[cats[i]].color.toString(16).padStart(6,'0')+'"></span>'+
      '<span class="nm">'+names[i]+'</span><span class="id">'+norads[i]+'</span></div>').join('');
    res.classList.add('open'); hot=-1;
    res.querySelectorAll('.res').forEach(el=>el.addEventListener('click',()=>{
      const i=+el.dataset.i;
      if(!catOn[cats[i]]){ catOn[cats[i]]=true;
        document.querySelectorAll('.chip')[cats[i]].classList.remove('off'); applyFilters(); }
      select(i); focusCam(i); close(); inp.blur();
    }));
  }
  inp.addEventListener('input',run);
  inp.addEventListener('keydown',e=>{
    const rows=res.querySelectorAll('.res');
    if(e.key==='ArrowDown'&&rows.length){ e.preventDefault(); hot=(hot+1)%rows.length; }
    else if(e.key==='ArrowUp'&&rows.length){ e.preventDefault(); hot=(hot-1+rows.length)%rows.length; }
    else if(e.key==='Enter'&&rows.length){ e.preventDefault(); rows[Math.max(0,hot)].click(); return; }
    else if(e.key==='Escape'){ close(); inp.blur(); return; }
    rows.forEach((el,k)=>el.classList.toggle('hot',k===hot));
  });
  document.addEventListener('pointerdown',e=>{ if(!$('searchrow').contains(e.target)) close(); });
}

/* ---------- modals ---------- */
function openModal(html){ $('modal').innerHTML=html; $('modalwrap').classList.add('open'); }
function closeModal(){ $('modalwrap').classList.remove('open'); }

function showAbout(){
  openModal(
  '<h2>ABOUT THIS TRACKER</h2><div class="prose">'+
  '<p>Every object here is real: the complete CelesTrak <em>active-satellites</em> catalog — '+
  N.toLocaleString('en-US')+' spacecraft — propagated live with the SGP4 model from each object\'s '+
  'two-line element set (snapshot '+DATA_DATE+', most elements under a day old at capture). '+
  'The view is drawn in the TEME inertial frame: orbits hold still while Earth rotates beneath them, '+
  'with the day/night terminator from the actual solar position.</p>'+
  '<p>Positions are typically accurate to a few kilometres near the element epoch and drift as elements age — '+
  'days for low orbits, longer for high ones. Two honest caveats: TLEs cannot represent NORAD IDs above 99,999 '+
  '(the catalog crossed that line in July 2026, so the newest launches are absent), and debris or rocket bodies '+
  'are not part of the <em>active</em> set. Per-satellite facts come from the CelesTrak SATCAT '+
  '(owner, launch, status, radar cross-section) and mission details from the UCS Satellite Database '+
  '(final May 2023 release — satellites launched since rely on the built-in constellation notes). '+
  'Load a fresher or larger set anytime via LOAD TLE SET — '+
  'the parser accepts any standard 2- or 3-line element file, including the full CelesTrak or Space-Track catalogs.</p>'+
  '</div><div class="keys">'+
  '<kbd>drag</kbd><span>rotate view</span>'+
  '<kbd>scroll / pinch</kbd><span>zoom</span>'+
  '<kbd>click</kbd><span>select a satellite</span>'+
  '<kbd>/</kbd><span>search</span>'+
  '<kbd>space</kbd><span>pause / resume time</span>'+
  '<kbd>+ / −</kbd><span>time speed</span>'+
  '<kbd>N</kbd><span>jump to now</span>'+
  '<kbd>esc</kbd><span>clear / close</span>'+
  '</div><div class="prose"><p>The observer panel computes true look angles from your position and flags each '+
  'overhead satellite as sunlit or in Earth\'s shadow. A ✦ marks rough naked-eye candidates: objects with a '+
  'radar cross-section of at least 1 m² that are sunlit while your sky is dark. Real brightness varies with '+
  'attitude, phase and surface — treat it as a shortlist, not a promise.</p><p>Earth imagery: NASA Blue Marble (day) and Black Marble city lights (night), public domain. This tracker is Cargo 001 aboard <a href="../" style="color:var(--amber-hi)">Golgafrincham</a>, a hold of gloriously unnecessary work.</p></div><div class="row"><button onclick="__closeModal()">CLOSE</button></div>');
}

function showLoad(){
  openModal(
  '<h2>LOAD A TLE SET</h2><div class="prose">'+
  '<p>Paste or open any standard TLE file (2-line or 3-line format). It replaces the current catalog — '+
  'for the freshest data, download a set from CelesTrak (celestrak.org → NORAD GP element sets) '+
  'and drop it here. Large files are fine; the full active catalog is ~16,000 objects.</p></div>'+
  '<textarea id="tlepaste" placeholder="ISS (ZARYA)&#10;1 25544U 98067A   26209.15279001 ...&#10;2 25544  51.6400 ..."></textarea>'+
  '<div class="row"><button id="tlefilebtn">OPEN FILE…</button>'+
  '<button id="tleapply">PARSE &amp; LOAD</button>'+
  '<button onclick="__closeModal()">CANCEL</button>'+
  '<input id="tlefile" type="file" accept=".tle,.txt,.3le" style="display:none"></div>'+
  '<div id="loadstatus"></div>');
  $('tlefilebtn').addEventListener('click',()=>$('tlefile').click());
  $('tlefile').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{ $('tlepaste').value=String(rd.result); $('loadstatus').textContent=f.name+' — ready to parse'; };
    rd.readAsText(f);
  });
  $('tleapply').addEventListener('click',()=>{
    const recs=parse3LE($('tlepaste').value);
    if(recs.length<1){ $('loadstatus').textContent='No valid element sets found in that text.'; return; }
    $('loadstatus').textContent='Parsing '+recs.length.toLocaleString('en-US')+' element sets…';
    select(-1);
    setTimeout(()=>rebuildFrom(recs),30);
  });
}
window.__closeModal=closeModal;

function rebuildFrom(records){
  buildCatalog(records,()=>{},()=>{
    satGeom.dispose();
    satGeom=new THREE.BufferGeometry();
    satPoints.geometry=satGeom;
    initSatBuffers();
    cursor=0; burst=N;
    applyFilters();
    $('loadstatus')&&($('loadstatus').textContent=N.toLocaleString('en-US')+' objects loaded.');
    setTimeout(closeModal,500);
  });
}

/* ---------- clock ---------- */
function fmtClock(ms){
  const d=new Date(ms);
  return d.toISOString().slice(0,19).replace('T',' ');
}
function dayOfYear(ms){
  const d=new Date(ms);
  return Math.floor((ms-Date.UTC(d.getUTCFullYear(),0,1))/86400000)+1;
}

/* ---------- main loop ---------- */
function loop(){
  requestAnimationFrame(loop);
  const t=performance.now();
  let dt=(t-lastFrame)/1000; lastFrame=t;
  if(dt>0.25) dt=0.25;
  const dtSim=paused?0:dt*SPEEDS[spdIdx];
  simMs+=dtSim*1000;

  tmpDate.setTime(simMs);
  gmstNow=satellite.gstime(tmpDate);
  earthGroup.rotation.y=gmstNow;
  updateSun(simMs);

  sgp4Batch();
  advanceAll(dtSim);
  pushPositions();

  overheadEval(false);
  updateSightLine();
  if(sel>=0){
    const o=3*sel;
    selGeom.attributes.position.array.set([posLive[o],posLive[o+1],posLive[o+2]]);
    selGeom.attributes.position.needsUpdate=true;
    refreshOrbit(false); updateCard(false);
  }
  $('clock').textContent=fmtClock(simMs);
  $('doy').textContent='DOY '+dayOfYear(simMs);

  applyCamera();
  renderer.render(scene,camera);
}

/* ---------- keyboard ---------- */
function initKeys(){
  document.addEventListener('keydown',e=>{
    const typing=/INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if(e.key==='Escape'){
      if(pickGlobeMode){ pickGlobeMode=false; $('pickglobe').classList.remove('armed'); return; }
      if($('modalwrap').classList.contains('open')) closeModal();
      else select(-1);
      return;
    }
    if(typing) return;
    if(e.key==='/'){ e.preventDefault(); $('search').focus(); }
    else if(e.key===' '){ e.preventDefault(); togglePause(); }
    else if(e.key==='+'||e.key==='='){ setSpeed(spdIdx+1); }
    else if(e.key==='-'||e.key==='_'){ setSpeed(spdIdx-1); }
    else if(e.key==='n'||e.key==='N'){ jumpNow(); }
  });
}
function togglePause(){ paused=!paused; $('pauseb').textContent=paused?'RESUME':'PAUSE'; }

/* ---------- observer & overhead pass logic ---------- */
const obs={set:false,lat:0,lon:0,p:new Float64Array(3),up:new Float64Array(3),ea:new Float64Array(3),no:new Float64Array(3)};
let obsGroup=null, pickGlobeMode=false, lastOvh=0, sightLine=null;
const WGS_A=6378.137/RE, WGS_E2=0.00669437999014;

function map3(x,y,z,out){ out[0]=y; out[1]=z; out[2]=x; }   // ECEF/ECI -> three axes

function setObserver(latDeg,lonDeg){
  obs.lat=latDeg; obs.lon=lonDeg; obs.set=true;
  const ph=latDeg/DEG, la=lonDeg/DEG;
  const sp=Math.sin(ph),cp=Math.cos(ph),sl=Math.sin(la),cl=Math.cos(la);
  const Nn=WGS_A/Math.sqrt(1-WGS_E2*sp*sp);
  map3(Nn*cp*cl, Nn*cp*sl, Nn*(1-WGS_E2)*sp, obs.p);
  map3(cp*cl, cp*sl, sp, obs.up);
  map3(-sl, cl, 0, obs.ea);
  map3(-sp*cl, -sp*sl, cp, obs.no);
  $('obslat').value=latDeg.toFixed(3); $('obslon').value=lonDeg.toFixed(3);
  buildObsMarker();
  $('ovctl').hidden=false;
  lastOvh=0;
  overheadEval(true);
}
function clearObserver(){
  obs.set=false;
  if(obsGroup){ earthGroup.remove(obsGroup); obsGroup=null; }
  if(sightLine) sightLine.visible=false;
  $('ovctl').hidden=true; $('overhead').innerHTML='';
  $('obsstate').textContent='No observer set — enter coordinates, use device location, or pick a point on the globe.';
}
function buildObsMarker(){
  if(obsGroup) earthGroup.remove(obsGroup);
  obsGroup=new THREE.Group();
  const pg=new THREE.BufferGeometry();
  pg.setAttribute('position',new THREE.BufferAttribute(new Float32Array([obs.p[0]*1.001,obs.p[1]*1.001,obs.p[2]*1.001]),3));
  pg.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,0,0),2);
  obsGroup.add(new THREE.Points(pg,new THREE.PointsMaterial({color:0xffcf6b,size:7*Math.min(devicePixelRatio||1,2),sizeAttenuation:false,depthWrite:false})));
  for(const rad of [0.02,0.045]){
    const SEG=40, arr=new Float32Array(SEG*3);
    for(let k=0;k<SEG;k++){
      const a=k/SEG*2*Math.PI, ce=Math.cos(a)*rad, sn=Math.sin(a)*rad;
      for(let c=0;c<3;c++) arr[3*k+c]=obs.p[c]*1.0015+obs.ea[c]*ce+obs.no[c]*sn;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(arr,3));
    const ln=new THREE.LineLoop(g,new THREE.LineBasicMaterial({color:0xffcf6b,transparent:true,opacity:rad<0.03?0.9:0.35}));
    ln.frustumCulled=false;
    obsGroup.add(ln);
  }
  earthGroup.add(obsGroup);
}
/* rotate a three-mapped vector between ECEF and ECI about the +Y (polar) axis */
function ry(v,ang,out){
  const c=Math.cos(ang),s=Math.sin(ang);
  out[0]=v[0]*c+v[2]*s; out[1]=v[1]; out[2]=-v[0]*s+v[2]*c;
}
const _pE=new Float64Array(3),_uE=new Float64Array(3),_eE=new Float64Array(3),_nE=new Float64Array(3),_sE=new Float64Array(3);
function obsBasisECI(){
  ry(obs.p,gmstNow,_pE); ry(obs.up,gmstNow,_uE); ry(obs.ea,gmstNow,_eE); ry(obs.no,gmstNow,_nE);
}
function sunlit(i){
  const o=3*i, x=posLive[o],y=posLive[o+1],z=posLive[o+2];
  const al=x*sunDir[0]+y*sunDir[1]+z*sunDir[2];
  return al>0 || (x*x+y*y+z*z-al*al)>1;      // outside cylindrical umbra
}
function lookAngleSel(i){
  obsBasisECI();
  const o=3*i;
  const dx=posLive[o]-_pE[0],dy=posLive[o+1]-_pE[1],dz=posLive[o+2]-_pE[2];
  const rg=Math.hypot(dx,dy,dz);
  const el=Math.asin((dx*_uE[0]+dy*_uE[1]+dz*_uE[2])/rg)*DEG;
  let az=Math.atan2(dx*_eE[0]+dy*_eE[1]+dz*_eE[2], dx*_nE[0]+dy*_nE[1]+dz*_nE[2])*DEG;
  if(az<0) az+=360;
  return {el:el,az:az,rng:rg*RE};
}
const WINDS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function compass(az){ return WINDS[Math.round(az/22.5)%16]; }
function sunElAtObs(){
  return Math.asin(sunDir[0]*_uE[0]+sunDir[1]*_uE[1]+sunDir[2]*_uE[2])*DEG;  // both in ECI
}
function overheadEval(force){
  if(!obs.set||!N) return;
  const t=performance.now();
  if(!force && t-lastOvh<700) return;
  lastOvh=t;
  obsBasisECI();
  const minEl=+$('minel').value, visOnly=$('visonly').checked;
  const sunEl=sunElAtObs();
  const sky=sunEl<-6?'DARK':(sunEl<0?'TWILIGHT':'DAYLIGHT');
  const list=[];
  let litN=0;
  for(let i=0;i<N;i++){
    if(!alive[i]) continue;
    const o=3*i;
    const dx=posLive[o]-_pE[0],dy=posLive[o+1]-_pE[1],dz=posLive[o+2]-_pE[2];
    const rg=Math.hypot(dx,dy,dz);
    const se=(dx*_uE[0]+dy*_uE[1]+dz*_uE[2])/rg;
    if(se<Math.sin(minEl/DEG)) continue;
    const lit=sunlit(i);
    if(lit) litN++;
    if(visOnly&&!lit) continue;
    let az=Math.atan2(dx*_eE[0]+dy*_eE[1]+dz*_eE[2], dx*_nE[0]+dy*_nE[1]+dz*_nE[2])*DEG;
    if(az<0) az+=360;
    list.push({i:i,el:Math.asin(se)*DEG,az:az,rng:rg*RE,lit:lit});
  }
  list.sort((a,b)=>b.el-a.el);
  const latS=Math.abs(obs.lat).toFixed(2)+'°'+(obs.lat>=0?'N':'S');
  const lonS=Math.abs(obs.lon).toFixed(2)+'°'+(obs.lon>=0?'E':'W');
  $('obsstate').textContent=latS+' '+lonS+' · SUN '+(sunEl>=0?'+':'−')+Math.abs(sunEl).toFixed(0)+'° ('+sky+')\n'+
    list.length+(visOnly?' SUNLIT':'')+' SATELLITES ABOVE '+minEl+'°'+(visOnly?'':' · '+litN+' SUNLIT')+
    (sky==='DARK'?' · GOOD VIEWING SKY':sky==='TWILIGHT'?' · BRIGHT PASSES POSSIBLE':' · TOO BRIGHT FOR NAKED EYE');
  const top=list.slice(0,16);
  $('overhead').innerHTML = top.length ? top.map(r=>{
    const sc=SC.get(norads[r.i]);
    const big=r.lit && sky!=='DAYLIGHT' && sc && parseFloat(sc.rcs)>=1;
    return '<div class="ov" data-i="'+r.i+'">'+
      '<span class="dot" style="background:#'+CATS[cats[r.i]].color.toString(16).padStart(6,'0')+'"></span>'+
      (big?'<span class="vis" title="large & sunlit in a dark sky — naked-eye candidate">✦</span>':'')+
      '<span class="nm">'+names[r.i]+'</span>'+
      '<span class="geo">'+Math.round(r.el)+'° '+compass(r.az)+' · '+Math.round(r.rng)+' km</span>'+
      '<span class="st '+(r.lit?'lit':'shd')+'">'+(r.lit?'SUNLIT':'SHADOW')+'</span></div>';
  }).join('') : '<div id="ovempty">Nothing above '+minEl+'°'+(visOnly?' in sunlight':'')+' right now — try a lower cutoff or let time run.</div>';
  $('overhead').querySelectorAll('.ov').forEach(el=>el.addEventListener('click',()=>{
    const i=+el.dataset.i;
    if(!catOn[cats[i]]){ catOn[cats[i]]=true;
      document.querySelectorAll('.chip')[cats[i]].classList.remove('off'); applyFilters(); }
    select(i); focusCam(i);
  }));
}
function updateSightLine(){
  if(!sightLine){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
    sightLine=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xffcf6b,transparent:true,opacity:0.45}));
    sightLine.frustumCulled=false;
    scene.add(sightLine);
  }
  if(sel<0||!obs.set){ sightLine.visible=false; return; }
  const la=lookAngleSel(sel);
  if(la.el<=0){ sightLine.visible=false; return; }
  const a=sightLine.geometry.attributes.position.array, o=3*sel;
  a[0]=_pE[0];a[1]=_pE[1];a[2]=_pE[2];
  a[3]=posLive[o];a[4]=posLive[o+1];a[5]=posLive[o+2];
  sightLine.geometry.attributes.position.needsUpdate=true;
  sightLine.visible=true;
}

/* ---------- per-satellite metadata (SATCAT + UCS) ---------- */
const SC=new Map(), UC=new Map();
function parseMeta(text){
  let mode='';
  for(const ln of text.split('\n')){
    if(ln==='#S'){mode='S';continue;}
    if(ln==='#U'){mode='U';continue;}
    if(!ln) continue;
    const p=ln.split('|'); const id=+p[0];
    if(mode==='S') SC.set(id,{ow:p[1],dt:p[2],si:p[3],os:p[4],rcs:p[5]});
    else if(mode==='U') UC.set(id,{pu:p[1],de:p[2],us:p[3],op:p[4],ma:p[5],ve:p[6],co:p[7]});
  }
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function missionHTML(i){
  const id=norads[i], sc=SC.get(id), uc=UC.get(id), blurb=famBlurb(names[i]);
  let h='';
  if(blurb) h+='<div class="mline">'+esc(blurb)+'</div>';
  else if(uc&&uc.pu) h+='<div class="mline">'+esc(uc.pu+(uc.de?' — '+uc.de:''))+'.</div>';
  else h+='<div class="mline" style="color:var(--dim)">No public mission record in the bundled catalogs'+(id>90000?' — likely a recent launch':'')+'.</div>';
  const cells=[];
  if(uc){
    if(blurb&&uc.pu) cells.push(['PURPOSE',uc.pu+(uc.de?' — '+uc.de:'')]);
    if(uc.op) cells.push(['OPERATOR',uc.op,true]);
    if(uc.us) cells.push(['USERS',uc.us]);
    if(uc.ma) cells.push(['LAUNCH MASS',uc.ma+' kg']);
  }
  if(sc){
    if(sc.ow&&OWNER_NAMES[sc.ow]) cells.push(['STATE / OWNER',OWNER_NAMES[sc.ow]]);
    let l=sc.dt||'';
    if(sc.si&&SITE_NAMES[sc.si]) l+=(l?' · ':'')+SITE_NAMES[sc.si];
    if(uc&&uc.ve) l+=(l?' · ':'')+uc.ve;
    if(l) cells.push(['LAUNCHED',l,true]);
    cells.push(['STATUS',STATUS_NAMES[sc.os]!==undefined?STATUS_NAMES[sc.os]:sc.os]);
    if(sc.rcs) cells.push(['RADAR X-SECTION',sc.rcs+' m²']);
  }
  if(cells.length){
    h+='<div class="mgrid">'+cells.map(c=>'<div'+(c[2]&&String(c[1]).length>26?' class="wide"':'')+'><div class="lbl">'+c[0]+'</div><div class="v">'+esc(String(c[1]))+'</div></div>').join('')+'</div>';
  }
  if(uc&&uc.co) h+='<div class="note">'+esc(uc.co)+'</div>';
  return h;
}

/* ---------- boot ---------- */
function bootError(msg){
  $('loadstage').textContent='INITIALIZATION FAILED';
  const el=$('loaderr'); el.style.display='block'; el.textContent=msg;
}

async function decompressPayload(b64){
  if(typeof DecompressionStream==='undefined')
    throw new Error('This browser does not support DecompressionStream. Please use a current version of Chrome, Edge, Firefox, or Safari (16.4+).');
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const ds=new DecompressionStream('gzip');
  const stream=new Blob([bytes]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

async function boot(){
  try{
    initScene(); initControls(); initKeys(); buildChips(); initSearch();
    $('pauseb').addEventListener('click',togglePause);
    $('faster').addEventListener('click',()=>setSpeed(spdIdx+1));
    $('slower').addEventListener('click',()=>setSpeed(spdIdx-1));
    $('nowb').addEventListener('click',jumpNow);
    $('aboutbtn').addEventListener('click',showAbout);
    $('loadbtn').addEventListener('click',showLoad);
    $('carddismiss').addEventListener('click',()=>select(-1));
    $('obsset').addEventListener('click',()=>{
      const la=parseFloat($('obslat').value), lo=parseFloat($('obslon').value);
      if(isFinite(la)&&isFinite(lo)&&Math.abs(la)<=90&&Math.abs(lo)<=180) setObserver(la,lo);
      else $('obsstate').textContent='Enter latitude −90…90 and longitude −180…180 (south and west are negative).';
    });
    $('obslat').addEventListener('keydown',e=>{ if(e.key==='Enter')$('obsset').click(); });
    $('obslon').addEventListener('keydown',e=>{ if(e.key==='Enter')$('obsset').click(); });
    $('obsgeo').addEventListener('click',()=>{
      if(!navigator.geolocation){ $('obsstate').textContent='Geolocation unavailable — enter coordinates or pick on the globe.'; return; }
      $('obsstate').textContent='Requesting device location…';
      navigator.geolocation.getCurrentPosition(
        p=>setObserver(p.coords.latitude,p.coords.longitude),
        ()=>{ $('obsstate').textContent='Location blocked or unavailable here — enter coordinates or use PICK ON GLOBE.'; },
        {timeout:8000});
    });
    $('pickglobe').addEventListener('click',()=>{
      pickGlobeMode=!pickGlobeMode;
      $('pickglobe').classList.toggle('armed',pickGlobeMode);
      if(pickGlobeMode) $('obsstate').textContent='Click a point on the globe to place your observer…';
    });
    $('obsclear').addEventListener('click',clearObserver);
    $('minel').addEventListener('change',()=>overheadEval(true));
    $('visonly').addEventListener('change',()=>overheadEval(true));
    $('modalwrap').addEventListener('pointerdown',e=>{ if(e.target.id==='modalwrap') closeModal(); });
    setSpeed(0);

    $('loadstage').textContent='DECOMPRESSING ELEMENT SETS';
    $('barfill').style.width='8%';
    const [text, metaText]=await Promise.all([decompressPayload(TLE_B64), decompressPayload(META_B64)]);
    parseMeta(metaText);
    $('loadstage').textContent='PARSING TLE CATALOG';
    const records=parse3LE(text);
    buildCatalog(records,
      (done,total)=>{
        $('barfill').style.width=(8+84*done/total)+'%';
        $('loadnum').textContent=done.toLocaleString('en-US')+' / '+total.toLocaleString('en-US')+' ELEMENT SETS';
      },
      ()=>{
        $('loadstage').textContent='INITIALIZING SGP4 STATE';
        initSatBuffers();
        applyFilters();
        burst=N;
        let aliveN=0; for(let i=0;i<N;i++) if(alive[i]) aliveN++;
        let med=0; { const ages=[]; for(let i=0;i<N;i++) if(alive[i]) ages.push(epochAge[i]);
          ages.sort((a,b)=>a-b); med=ages.length?ages[ages.length>>1]:0; }
        $('footinfo').textContent='ELEMENTS: CELESTRAK ACTIVE CATALOG · SNAPSHOT '+DATA_DATE+
          ' · MEDIAN ELSET AGE '+med.toFixed(1)+' D · PROPAGATION: SGP4 / SATELLITE.JS';
        $('barfill').style.width='100%';
        $('loadnum').textContent=aliveN.toLocaleString('en-US')+' OBJECTS ON ORBIT';
        lastFrame=performance.now();
        loop();
        setTimeout(()=>$('loader').classList.add('done'),450);
      });
  } catch(err){
    bootError(err.message||String(err));
  }
}
boot();
})();
