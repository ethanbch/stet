import { useEffect, useRef, useState } from "react";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type SpriteTextClass from "three-spritetext";
import { cssVar, idOf, reducedMotion, visible, type Link, type Node, type ViewProps } from "./shared";

type Libs = {
  ForceGraph3D: typeof import("3d-force-graph").default;
  THREE: typeof import("three");
  SpriteText: typeof SpriteTextClass;
};

// three.js is only fetched the first time the 3D view opens.
let libs: Promise<Libs> | undefined;
function loadLibs(): Promise<Libs> {
  libs ??= Promise.all([import("3d-force-graph"), import("three"), import("three-spritetext")]).then(
    ([fg, three, st]) => ({ ForceGraph3D: fg.default, THREE: three, SpriteText: st.default }),
  );
  libs.catch(() => (libs = undefined));
  return libs;
}

type Instance = ForceGraph3DInstance<Node, Link>;
type Visual = {
  node: Node;
  r: number;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
  halo?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  label: SpriteTextClass;
};

const REL_SIZE = 4;
const radius = (n: Node) => 3 + Math.min(5, n.degree * 0.9);

/** `#rrggbb` plus an alpha, in a form the graph's colour parser understands. */
function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** A shell that glows at its silhouette (fresnel), so it reads as a halo from every angle. */
function haloMaterial(T: Libs["THREE"], color: string): THREE.ShaderMaterial {
  return new T.ShaderMaterial({
    uniforms: { uColor: { value: new T.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.2);
        gl_FragColor = vec4(uColor, clamp(rim * 1.15, 0.0, 1.0) * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}

export function Graph3D({
  data,
  onlyLoose,
  colors,
  neighbours,
  selected,
  onSelect,
  theme,
  onFail,
}: ViewProps & { onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const graph = useRef<Instance | null>(null);
  const lib = useRef<Libs | null>(null);
  const [ready, setReady] = useState(false);
  const hover = useRef<string | undefined>(undefined);
  const sel = useRef<string | undefined>(undefined);
  sel.current = selected;
  const select = useRef(onSelect);
  select.current = onSelect;
  const fail = useRef(onFail);
  fail.current = onFail;
  // Set by the build effect; hover and selection call it to restyle without a rebuild.
  const paint = useRef<() => void>(() => {});
  const visuals = useRef(new Map<string, Visual>());

  // Load three.js, create the renderer once, tear everything down on unmount.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    const stopRotate = () => {
      const c = graph.current?.controls() as OrbitControls | undefined;
      if (c) c.autoRotate = false;
    };
    const events = ["pointerdown", "wheel", "keydown", "touchstart"] as const;

    loadLibs()
      .then((l) => {
        if (cancelled) return;
        lib.current = l;
        const g = new l.ForceGraph3D(el, { controlType: "orbit" }) as unknown as Instance;
        graph.current = g;
        g.width(el.clientWidth).height(el.clientHeight).backgroundColor("rgba(0,0,0,0)").showNavInfo(false);
        const controls = g.controls() as OrbitControls;
        controls.autoRotate = !reducedMotion();
        controls.autoRotateSpeed = 0.5;
        controls.addEventListener("start", stopRotate);
        // Soft sky fill plus a key light that follows the camera, so spheres keep their shading while orbiting.
        const T = l.THREE;
        const key = new T.DirectionalLight(new T.Color(1, 1, 1), 2.4);
        key.position.set(-0.6, 1, 0.8);
        const camera = g.camera();
        camera.add(key, key.target);
        key.target.position.set(0, 0, -1);
        g.scene().add(camera);
        g.lights([new T.HemisphereLight(new T.Color(1, 1, 1), new T.Color(0.35, 0.35, 0.4), 1.4)]);
        for (const e of events) el.addEventListener(e, stopRotate, { passive: true });
        ro = new ResizeObserver(() => g.width(el.clientWidth).height(el.clientHeight));
        ro.observe(el);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) fail.current();
      });

    return () => {
      cancelled = true;
      ro?.disconnect();
      for (const e of events) el.removeEventListener(e, stopRotate);
      const g = graph.current;
      if (g) {
        (g.controls() as OrbitControls).removeEventListener("start", stopRotate);
        g._destructor();
        g.renderer().dispose();
      }
      graph.current = null;
      el.replaceChildren();
      setReady(false);
    };
  }, []);

  // Build the scene: runs again when the data, the filter or the theme changes.
  useEffect(() => {
    const g = graph.current;
    const T = lib.current?.THREE;
    const SpriteText = lib.current?.SpriteText;
    if (!ready || !g || !T || !SpriteText) return;
    const ink = cssVar("--ink");
    const muted = cssVar("--ink-muted");
    const edge = cssVar("--border-strong");
    const accent = cssVar("--accent");
    const warn = cssVar("--status-warning");
    const page = cssVar("--page");
    const font = cssVar("--font-sans");
    const motion = !reducedMotion();
    const { nodes, links } = visible(data, onlyLoose);
    const allLabels = nodes.length <= 30;

    const disposable: { dispose: () => void }[] = [];
    const keep = <D extends { dispose: () => void }>(d: D) => (disposable.push(d), d);
    const sphere = keep(new T.SphereGeometry(1, 48, 32));
    const focusRing = new T.Mesh(sphere, keep(haloMaterial(T, accent)));
    // Halos are wider than their sphere: keep them out of picking so they don't hide the nodes behind.
    const noPick = () => {};
    focusRing.raycast = noPick;
    const map = visuals.current;
    map.clear();

    const build = (n: Node): THREE.Object3D => {
      const r = radius(n);
      const group = new T.Group();
      const color = new T.Color(cssVar(colors.get(n.tag) ?? "--series-5"));
      const core = new T.Mesh(
        sphere,
        keep(
          new T.MeshPhysicalMaterial({
            color,
            roughness: 0.38,
            metalness: 0,
            clearcoat: 1,
            clearcoatRoughness: 0.2,
            emissive: color,
            emissiveIntensity: 0.12,
            transparent: true,
          }),
        ),
      );
      core.scale.setScalar(r);
      group.add(core);
      let halo: Visual["halo"];
      if (n.orphan || n.island) {
        halo = new T.Mesh(sphere, keep(haloMaterial(T, warn)));
        halo.scale.setScalar(r + 3);
        halo.raycast = noPick;
        group.add(halo);
      }
      const label = new SpriteText(n.id, 4.5, n.status === "draft" ? muted : ink);
      label.fontFace = font;
      label.fontWeight = "500";
      label.backgroundColor = withAlpha(page, 0.72);
      label.padding = [2.5, 1.2];
      label.borderRadius = 2;
      label.position.y = -(r + 5.5);
      label.material.depthTest = false;
      label.renderOrder = 10;
      disposable.push(label.material, { dispose: () => label.material.map?.dispose() });
      group.add(label);
      map.set(n.id, { node: n, r, core, halo, label });
      return group;
    };

    const focus = () => sel.current ?? hover.current;
    const touches = (l: Link) => {
      const f = focus();
      return !!f && (idOf(l.source) === f || idOf(l.target) === f);
    };

    paint.current = () => {
      const f = focus();
      const near = f ? neighbours.get(f) : undefined;
      for (const [id, v] of map) {
        const on = !f || f === id || !!near?.has(id);
        v.core.material.opacity = on ? 1 : 0.14;
        if (v.halo) v.halo.material.uniforms.uOpacity.value = on ? 1 : 0.14;
        v.label.visible = f ? on : allLabels;
        const weight = id === f ? "600" : "500";
        if (v.label.fontWeight !== weight) v.label.fontWeight = weight;
      }
      const fv = f ? map.get(f) : undefined;
      focusRing.removeFromParent();
      if (fv) {
        focusRing.scale.setScalar(fv.r + (fv.halo ? 6 : 3));
        fv.core.parent?.add(focusRing);
      }
      g.linkColor(g.linkColor())
        .linkWidth(g.linkWidth())
        .linkDirectionalParticles(g.linkDirectionalParticles())
        .linkDirectionalArrowLength(g.linkDirectionalArrowLength());
    };

    let fitted = false;
    g.nodeId("id")
      .nodeLabel(() => "")
      // Dragging competes with the orbit controls, and the library's drag handler threw on our grouped nodes.
      .enableNodeDrag(false)
      .nodeRelSize(REL_SIZE)
      // Arrows stop at the sphere: the library sizes it from nodeVal.
      .nodeVal((n: Node) => (radius(n) / REL_SIZE) ** 3)
      .nodeThreeObject(build)
      .linkOpacity(0.9)
      .linkColor((l: Link) => (touches(l) ? accent : focus() ? withAlpha(edge, 0.3) : edge))
      .linkWidth((l: Link) => (touches(l) ? 0.8 : 0))
      .linkDirectionalArrowLength((l: Link) => (touches(l) ? 3.5 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalParticles((l: Link) => (motion && touches(l) ? 3 : 0))
      .linkDirectionalParticleWidth(1.6)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleColor(() => accent)
      .onNodeHover((n: Node | null) => {
        hover.current = n?.id ?? undefined;
        if (n) (g.controls() as OrbitControls).autoRotate = false;
        paint.current();
      })
      .onNodeClick((n: Node) => select.current(sel.current === n.id ? undefined : n.id))
      .onBackgroundClick(() => select.current(undefined))
      .cooldownTicks(150)
      .onEngineStop(() => {
        if (fitted) return;
        fitted = true;
        g.zoomToFit(motion ? 600 : 0, 60);
      })
      .graphData({ nodes, links });
    // Same bounded charge as the 2D view, so separate groups stay in frame.
    g.d3Force("charge")?.strength(-120).distanceMax(260);
    g.d3Force("link")?.distance(45);
    paint.current();

    return () => {
      paint.current = () => {};
      for (const d of disposable) d.dispose();
    };
  }, [ready, data, onlyLoose, colors, theme, neighbours]);

  // Selection: restyle, then fly the camera to the node.
  useEffect(() => {
    const g = graph.current;
    if (!ready || !g) return;
    paint.current();
    const n = selected ? visuals.current.get(selected)?.node : undefined;
    if (!n || n.x === undefined) return;
    const { x = 0, y = 0, z = 0 } = n;
    const d = 160;
    const len = Math.hypot(x, y, z);
    const to = len < 1 ? { x, y, z: z + d } : { x: x * (1 + d / len), y: y * (1 + d / len), z: z * (1 + d / len) };
    (g.controls() as OrbitControls).autoRotate = false;
    g.cameraPosition(to, { x, y, z }, reducedMotion() ? 0 : 900);
  }, [ready, selected]);

  return <div className="graph" ref={box} role="img" aria-label="3D graph of links between fiches" />;
}
