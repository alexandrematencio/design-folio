import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import wordmark from "../assets/aaxlo-wordmark.svg?raw";

/**
 * THE FOURTH ITEM OF THE MENU — AAXLO, as a solid standing on the floor.
 *
 * Alexandre, 2026-10-22: the floor engraving read oddly; the agency gets its
 * own wordmark instead, in 3D, the AAXLO glyph as its O, standing on the
 * floor at an angle, a fifth of the letter height deep. Hidden on arrival,
 * revealed as the scroll reaches the menu, and never in the way of the
 * camera on its road to the hollow under the stair.
 *
 * HIDDEN BY THE STAIR, NOT BY A SWITCH. The mark stands behind the solid and
 * off its −Z flank. From the rest pose — the isometric eye, along (1, 1, 1) —
 * every ray to it passes through the stair, so the rest frame stays the CSS
 * page byte for byte (tools/shoot.mjs asserts it). As the orbit swings the eye
 * round to +X for the menu, the stair's shadow swings off it and the mark
 * comes out from behind on its own: the reveal is the camera move, nothing
 * is faded. Moving it means re-checking both ends: occluded at rest (the
 * shoot), and clear of the bore's axis (x = −0.5) on the way in.
 *
 * WHICH SIDE. −Z is where the camera goes next, but only the −Z flank is both
 * behind the stair from the rest eye and beside it from the menu eye. Facing
 * the mouth, the word stands to its right, clear of the opening; the drive
 * into the bore passes it on the flank.
 *
 * WHERE EXACTLY — searched, not eyeballed (2026-10-22). The first place
 * (x −3.2) let 256 px of the O over the top of the stair at rest on a
 * 1995 × 1198 window, and the shoot's rest check did not see it: it tests the
 * largest stray colour, and 256 px is a rounding error of a frame. The mark
 * was painted flat magenta and counted on a grid of placements: x −2.6,
 * z −2.3, yaw 135° gives 0 px at rest on 1995 × 1198, 1600 × 1000,
 * 1440 × 900 and 1280 × 720, whole and in frame at the menu. Further back
 * along −X clears the stair's top less well; further along −Z runs off the
 * right edge.
 */

/** The letter height (cap height of the SVG's 37 units), in glyph units. */
const HEIGHT = 0.45;
/** "1/5 de la hauteur, en profondeur." */
const DEPTH = HEIGHT / 5;
/** Floor of the room, the bottom of the glyph's box (StepEngravings.js). */
const FLOOR_Y = -1.5;

/**
 * Centre of the footprint, glyph space. Against the stair's back corner and
 * beside its −Z face (z = −1.25). Measured, not chosen: see the header.
 */
export const MARK_CENTRE = [-2.6, FLOOR_Y, -2.3];

/**
 * Yaw about +Y. At 90° the face looks along +X, straight at the menu eye,
 * reading toward −Z (screen right). The extra 45° is the angle Alexandre
 * asked for: the word recedes, A in front, the glyph further back.
 */
const YAW = THREE.MathUtils.degToRad(135);

/** At hover the glyph warms, as the carved names deepen. ~150 ms. */
const HOVER_GLOW = 0.35;
const HOVER_SECONDS = 0.15;

const SVG_UNITS = 37;

const lerpN = (a, b, t) => a + (b - a) * t; // the viewBox height, letters top to bottom

function buildGeometry() {
	const { paths } = new SVGLoader().parse(wordmark);
	const groups = new Map(); // fill colour -> shapes
	for (const path of paths) {
		const fill = path.userData.style.fill;
		if (!groups.has(fill)) groups.set(fill, []);
		groups.get(fill).push(...SVGLoader.createShapes(path));
	}
	return [...groups].map(([fill, shapes]) => {
		const geometry = new THREE.ExtrudeGeometry(shapes, {
			depth: (DEPTH / HEIGHT) * SVG_UNITS,
			bevelEnabled: false,
			curveSegments: 10,
		});
		return { fill, geometry };
	});
}

/**
 * THE STUDIO'S LOOK, on the pages that have one (Scene.js, SHADING.studio).
 *
 * Alexandre, 2026-11-03: beside the stair the word read "bien trop matte",
 * and it floated — no contact with the floor. It was a plain plastic at
 * roughness 0.55 with nothing to reflect, next to a lacquered solid that
 * mirrors the room's softboxes. So it takes the stair's lacquer and, at a
 * fraction, the stair's environment. A flat face under an orthographic eye
 * mirrors ONE direction, so the room alone paints each face one value — the
 * flat look again, only greyer. What varies across a face has to come from
 * where it is, and that is the floor:
 *   - the studio bake's floor map, which the word is now baked into
 *     (tools/bake-glyph-studio.py): the sky the floor around it loses, the
 *     word loses too — dark at its foot, opening up as it rises;
 *   - the floor IN the lacquer, traced per pixel (see `floor` below).
 * All of it rides the studio ramp, like the stair's own bake: at rest the
 * word is hidden behind the stair anyway, and it is the word it always was.
 */
const STUDIO_LOOK = {
	// How much of the stair's room the lacquer reflects. 1 is the stair's own,
	// whose ceiling is driven far past white on purpose (the treads must
	// clip): on the word it greyed every face and lit every top edge into a
	// white line. Tuned on the AAXLO shot: a sheen, the ink kept.
	env: 0.15,
	// How far up the floor's shade reaches on the word, glyph units.
	reach: HEIGHT * 0.9,
	// The share of the floor's occlusion left at the top of that reach.
	top: 0.35,
	// The floor in the lacquer. The stair's environment has a near-black
	// ground on purpose (the risers must stay cobalt), so it cannot give the
	// word what a black lacquer on a white floor shows in every product shot:
	// the floor, bright up the lower half of each letter, cut dark at the
	// very foot by the contact shadow. Traced here per pixel instead: the
	// view ray mirrored off the face down to the floor plane, the floor's
	// light read from the bake where it lands. This is the paper's radiance.
	floor: 0.95,
	// FLAGGED, as a photographer would: with the whole white floor in it, the
	// lacquer went mid-grey and the word stopped being black. Only the floor
	// near the word is lit in the reflection — it fades over this distance,
	// glyph units, from the foot — so the reflection is a band low on each
	// letter, cut by the contact shadow, and the rest stays ink.
	falloff: HEIGHT * 0.6,
	// The grazing flanks went to white threads at full Schlick: capped.
	grazing: 0.2,
	// THE STAIR'S SHADOW, on the word as on the floor. Alexandre, 2026-11-03:
	// the tops of the two A's stood in the stair's shadow and shone as if in
	// full light. The key's shadow map did cut the key off them — but what
	// greys a lacquered top is not the key, it is the ceiling it mirrors, and
	// the environment knows nothing of the stair. In this studio the ceiling
	// IS the softbox that casts that shadow: where the stair hides the key
	// from a point, it hides the bright ceiling from it too. So the word's
	// indirect light (the mirrored room, the sky, the floor in the lacquer)
	// is dimmed by the key's own shadow term, read from the same map at the
	// same texel. One shadow, one source, every surface: the floor and the
	// word darken together and their penumbras coincide.
	// How much: a MATTE floor in the shadow keeps the open sky and loses half
	// its light (AAXLO shot, 252 -> 184). A MIRROR loses more, because what
	// it mirrors is the very source that is hidden. 0.55 matched the floor's
	// ratio and still read as lit; 0.75 puts the first A's top near its own
	// faces, which is what a lacquer in shade looks like. 1 blacks it out.
	shade: 0.75,
};

/**
 * INSIDE THE O'S SLOTS. Alexandre, 2026-11-03, two screenshots: seen at an
 * angle, the walls of the slots between the O's slices read GREY, not the
 * dark orange a coral slot in shade would be. Every term that lights them
 * looked at the room as if the wall were out in the open: the ceiling in the
 * lacquer, the white floor traced in it, the sky, the key. A slot is 1.75
 * SVG units wide and 7.4 deep; from half-way in, a wall sees a sliver of
 * room at either end and, everywhere else, the coral wall facing it. What
 * fills a slot is coral bounced off coral, so it is DARKER and MORE orange —
 * and the white of the floor or the ceiling, added on top of a dim coral, is
 * exactly what turns it grey.
 *
 * Done exactly, per pixel, because the slot is a known shape: straight walls
 * at 45° in the SVG, both ends open along the extrusion. For a direction
 * leaving the wall, the opposite wall is hit after `gap / (d·n)`; the ray
 * gets out only if by then it has run past the front or the back face.
 *   - reflections (room, coat, floor): kept where the mirrored ray gets out,
 *     replaced by the facing wall where it does not;
 *   - the key: the same test along the light, since the shadow map's texels
 *     are coarser than the slot;
 *   - the sky (diffuse): the view factor of the two openings from that depth,
 *     the rest coral bounced once.
 */
const SLOT = {
	// The O's slices are cut along (1, 1) in the SVG: walls face ±(1, −1).
	normal: [Math.SQRT1_2, -Math.SQRT1_2, 0],
	// Measured off the SVG's straight edges: gaps and slices alternate at
	// 1.73 and 1.80 units.
	gap: 1.75,
	// The extrusion, SVG units: DEPTH in the geometry's own frame.
	depth: (DEPTH / HEIGHT) * SVG_UNITS,
	// How much of the light the facing wall sends back: coral's albedo times
	// the dim light it receives itself. Tuned on the slot shot: dark orange.
	bounce: 0.45,
	// What the facing wall gives a mirror ray that hits it, as a share of
	// this wall's own diffuse: a lacquer mirrors its neighbour, dimly.
	mirror: 0.25,
};

function patchStudio(material, look) {
	const uniforms = {
		uMarkMap: { value: look.bake.floorMap },
		uMarkMin: { value: new THREE.Vector2(...look.bake.floor.min) },
		uMarkMax: { value: new THREE.Vector2(...look.bake.floor.max) },
		uMarkFloor: { value: look.bake.floor.y },
		uMarkContrast: { value: look.contrast },
		uMarkReach: { value: STUDIO_LOOK.reach },
		uMarkTop: { value: STUDIO_LOOK.top },
		uMarkFloorRefl: { value: STUDIO_LOOK.floor },
		uMarkFalloff: { value: STUDIO_LOOK.falloff },
		uMarkGrazing: { value: STUDIO_LOOK.grazing },
		uMarkShade: { value: STUDIO_LOOK.shade },
		uMarkSlot: { value: 0 },
		uMarkSlotN: { value: new THREE.Vector3(...SLOT.normal) },
		uMarkSlotGap: { value: SLOT.gap },
		uMarkSlotDepth: { value: SLOT.depth },
		uMarkSlotBounce: { value: SLOT.bounce },
		uMarkSlotMirror: { value: SLOT.mirror },
		// World to the geometry's own frame (SVG units), set per mesh before
		// each draw: the slot test runs where the slot is a plain box.
		uMarkToLocal: { value: new THREE.Matrix4() },
		uMarkStudio: look.studio,
		uMarkToGlyph: look.toGlyph,
		// The contact core, the floor's and the stair's (Scene.js).
		uMarkContactDist: { value: look.bake.contactMap },
		uMarkContactRange: { value: look.bake.contact?.range ?? 1 },
		uMarkContactDensity: { value: look.contact?.density ?? 0 },
		uMarkContactReach: { value: look.contact?.reach ?? 1 },
	};
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
				uniform mat4 uMarkToGlyph;
				varying vec3 vMarkGlyph;
				varying vec3 vMarkLocal;
				varying vec3 vMarkLocalN;`,
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
				vMarkGlyph = ( uMarkToGlyph * modelMatrix * vec4( transformed, 1.0 ) ).xyz;
				vMarkLocal = transformed;
				vMarkLocalN = objectNormal;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				`#include <common>
				uniform sampler2D uMarkMap;
				uniform vec2 uMarkMin;
				uniform vec2 uMarkMax;
				uniform float uMarkFloor;
				uniform float uMarkContrast;
				uniform float uMarkReach;
				uniform float uMarkTop;
				uniform sampler2D uMarkContactDist;
				uniform float uMarkContactRange;
				uniform float uMarkContactDensity;
				uniform float uMarkContactReach;
				uniform float uMarkStudio;
				uniform float uMarkFloorRefl;
				uniform float uMarkFalloff;
				uniform float uMarkGrazing;
				uniform float uMarkShade;
				uniform float uMarkSlot;
				uniform vec3 uMarkSlotN;
				uniform float uMarkSlotGap;
				uniform float uMarkSlotDepth;
				uniform float uMarkSlotBounce;
				uniform float uMarkSlotMirror;
				uniform mat4 uMarkToLocal;
				uniform mat4 uMarkToGlyph;
				varying vec3 vMarkGlyph;
				varying vec3 vMarkLocal;
				varying vec3 vMarkLocalN;
				float markKeyLit = 1.0;
				float markSlotOut = 1.0;

				// A view-space direction into the geometry's frame.
				vec3 markToLocal( vec3 v ) {
					return normalize( mat3( uMarkToLocal ) * inverseTransformDirection( v, viewMatrix ) );
				}

				// 1 if a ray leaving the slot wall along d gets out of the
				// slot before it meets the facing wall, 0 if not.
				float markSlotEscape( vec3 d, vec3 n, float z ) {
					float dn = dot( d, n );
					if ( dn <= 1e-4 ) return 0.0;
					float hz = z + d.z * uMarkSlotGap / dn;
					float inside = smoothstep( -0.25, 0.25, hz ) * smoothstep( uMarkSlotDepth + 0.25, uMarkSlotDepth - 0.25, hz );
					return 1.0 - inside;
				}`,
			)
			.replace(
				// After the lights, before the clearcoat is folded in: the
				// key's shadow term, the one lights_fragment_begin applied to
				// the key, laid over everything that does not come from it.
				// The key is directional shadow 0: three puts shadow casters
				// first, and the fill casts none.
				"#include <lights_fragment_end>",
				`#include <lights_fragment_end>
				#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
				{
					DirectionalLightShadow _ks = directionalLightShadows[ 0 ];
					float _vis = receiveShadow ? getShadow( directionalShadowMap[ 0 ], _ks.shadowMapSize, _ks.shadowIntensity, _ks.shadowBias, _ks.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
					markKeyLit = mix( 1.0, _vis, uMarkShade * uMarkStudio );
					reflectedLight.indirectDiffuse *= markKeyLit;
					reflectedLight.indirectSpecular *= markKeyLit;
					clearcoatSpecularIndirect *= markKeyLit;
				}
				#endif
				if ( uMarkSlot > 0.5 ) {
					vec3 _ln = normalize( vMarkLocalN );
					// Only the slot walls: flat, square to the cut, in the
					// disc's plane. The rim's curve faces the cut at two
					// points only, and the band is narrower than a texel.
					float _wall = smoothstep( 0.995, 0.999, abs( dot( _ln, uMarkSlotN ) ) ) * ( 1.0 - step( 0.05, abs( _ln.z ) ) );
					if ( _wall > 0.0 ) {
						float _z = vMarkLocal.z + 0.5 * uMarkSlotDepth;
						float _g = uMarkSlotGap;
						float _a = _z;
						float _b = uMarkSlotDepth - _z;
						// The two openings' view factor from this depth.
						float _sky = 0.5 * ( 1.0 - _a / sqrt( _a * _a + _g * _g ) )
							+ 0.5 * ( 1.0 - _b / sqrt( _b * _b + _g * _g ) );
						vec3 _keyDir = markToLocal( directionalLights[ 0 ].direction );
						float _key = markSlotEscape( _keyDir, _ln, _z );
						vec3 _view = markToLocal( reflect( - geometryViewDir, normal ) );
						markSlotOut = mix( 1.0, markSlotEscape( _view, _ln, _z ), _wall );

						vec3 _diffuseIn = mix( vec3( 1.0 ), _sky + ( 1.0 - _sky ) * uMarkSlotBounce * diffuseColor.rgb, _wall );
						reflectedLight.indirectDiffuse *= _diffuseIn;
						reflectedLight.directDiffuse *= mix( 1.0, _key, _wall );
						reflectedLight.directSpecular *= mix( 1.0, _key, _wall );
						clearcoatSpecularDirect *= mix( 1.0, _key, _wall );
						// The facing wall in the mirror: its own coral, dim.
						vec3 _facing = ( reflectedLight.indirectDiffuse + reflectedLight.directDiffuse ) * uMarkSlotMirror;
						reflectedLight.indirectSpecular = reflectedLight.indirectSpecular * markSlotOut + _facing * ( 1.0 - markSlotOut );
						clearcoatSpecularIndirect *= markSlotOut;
					}
				}`,
			)
			.replace(
				"#include <opaque_fragment>",
				`{
					vec2 _muv = ( vMarkGlyph.xz - uMarkMin ) / ( uMarkMax - uMarkMin );
					float _occ = pow( texture2D( uMarkMap, _muv ).r, uMarkContrast );
					// Up the letter the floor's shade lets go fast, then slowly:
					// an exponential approach (95 % of the way at the reach),
					// not an S, which would start flat at the very foot.
					float _h = max( vMarkGlyph.y - uMarkFloor, 0.0 );
					float _up = 1.0 - exp( - 3.0 * _h / uMarkReach );
					_occ = mix( _occ, mix( 1.0, _occ, uMarkTop ), _up );
					// The contact core, as on the floor around it.
					_occ *= 1.0 - uMarkContactDensity * exp( - _h / uMarkContactReach );
					outgoingLight *= mix( 1.0, _occ, uMarkStudio );

					vec3 _n = normalize( normal );
					vec3 _r = reflect( - geometryViewDir, _n );
					vec3 _rg = normalize( mat3( uMarkToGlyph ) * inverseTransformDirection( _r, viewMatrix ) );
					if ( _rg.y < 0.0 ) {
						float _t = ( vMarkGlyph.y - uMarkFloor ) / max( - _rg.y, 1e-4 );
						vec2 _hit = ( vMarkGlyph.xz + _rg.xz * _t - uMarkMin ) / ( uMarkMax - uMarkMin );
						float _lit = pow( texture2D( uMarkMap, _hit ).r, uMarkContrast );
						// The floor it mirrors wears the core too: the dark line
						// at the foot of the reflection.
						_lit *= 1.0 - uMarkContactDensity * exp( - texture2D( uMarkContactDist, _hit ).r * uMarkContactRange / uMarkContactReach );
						// Schlick, the base's 4 % and the coat's on top of it.
						float _f = 0.04 + 0.96 * pow( 1.0 - saturate( dot( _n, geometryViewDir ) ), 5.0 );
						_f = min( _f * ( 1.0 + material.clearcoat ), uMarkGrazing );
						_lit *= exp( - _t * length( _rg.xz ) / uMarkFalloff );
					// The floor it mirrors lies in the same shadow.
					_lit *= markKeyLit * markSlotOut;
						// Off the floor plane's own horizon smoothly, and only
						// in the studio.
						_f *= smoothstep( 0.0, 0.08, - _rg.y ) * uMarkStudio;
						outgoingLight += uMarkFloorRefl * _lit * _f;
					}
				}
				#include <opaque_fragment>`,
			);
	};
	material.customProgramCacheKey = () => "aaxlo-studio";
	return uniforms;
}

export class AaxloMark {
	/**
	 * @param {THREE.Object3D} glyph  the solid; the mark rides on it
	 * @param {object} [look]  the studio, on the pages that have one:
	 *   { envMap, surface, bake, studio, toGlyph, contrast }
	 */
	constructor(glyph, look = null) {
		this.group = new THREE.Group();
		this.group.name = "aaxlo-mark";
		this.hovered = false;
		this.glow = 0;

		// Inner holder in SVG units: y flipped (SVG runs down), the word's
		// baseline on y = 0, centred along x and through its depth. Three
		// sees the negative determinant and flips the winding for us.
		const inner = new THREE.Group();
		const s = HEIGHT / SVG_UNITS;
		inner.scale.set(s, -s, s);

		this.parts = buildGeometry().map(({ fill, geometry }) => {
			const material = look
				? new THREE.MeshPhysicalMaterial({
						color: new THREE.Color(fill),
						metalness: 0,
						emissive: new THREE.Color(fill),
						emissiveIntensity: 0,
						envMap: look.envMap,
						envMapIntensity: STUDIO_LOOK.env,
						...look.surface,
					})
				: new THREE.MeshStandardMaterial({
						color: new THREE.Color(fill),
						roughness: 0.55,
						metalness: 0,
						emissive: new THREE.Color(fill),
						emissiveIntensity: 0,
					});
			const studioUniforms = look?.bake ? patchStudio(material, look) : null;
			const mesh = new THREE.Mesh(geometry, material);
			const glyphO = fill.toUpperCase() === "#FF8270";
			if (studioUniforms) {
				studioUniforms.uMarkSlot.value = glyphO ? 1 : 0;
				mesh.onBeforeRender = () =>
					studioUniforms.uMarkToLocal.value.copy(mesh.matrixWorld).invert();
			}
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			inner.add(mesh);
			return { mesh, material, glyphO };
		});

		const box = new THREE.Box3();
		for (const { mesh } of this.parts) {
			mesh.geometry.computeBoundingBox();
			box.union(mesh.geometry.boundingBox);
		}
		const centre = box.getCenter(new THREE.Vector3());
		for (const { mesh } of this.parts) {
			mesh.geometry.translate(-centre.x, -box.max.y, -centre.z);
		}

		this.group.add(inner);
		this.group.position.fromArray(MARK_CENTRE);
		this.group.rotation.y = YAW;
		glyph.add(this.group);

		// The hit box, in the group's frame: what the DOM target is fitted to.
		const halfW = ((box.max.x - box.min.x) / 2) * s;
		/** The word's length, glyph units: what the AAXLO shot frames. */
		this.width = 2 * halfW;
		this.corners = [];
		for (const x of [-halfW, halfW])
			for (const y of [0, HEIGHT])
				for (const z of [-DEPTH / 2, DEPTH / 2])
					this.corners.push(new THREE.Vector3(x, y, z));
		this.samples = [];
		for (let i = 0; i < 5; i++)
			for (let j = 0; j < 3; j++)
				this.samples.push(
					new THREE.Vector3(
						lerpN(-halfW, halfW, (i + 0.5) / 5),
						lerpN(0, HEIGHT, (j + 0.5) / 3),
						DEPTH / 2,
					),
				);
		this.raycaster = new THREE.Raycaster();
	}

	setHover(on) {
		this.hovered = on;
	}

	/** Centre of the word, glyph space — where its dive lands. */
	static get CENTRE() {
		return [MARK_CENTRE[0], MARK_CENTRE[1] + HEIGHT / 2, MARK_CENTRE[2]];
	}

	/**
	 * The way the word's face looks, glyph space: the extrusion's +Z turned
	 * by YAW. The AAXLO shot (Scene.js, STAGE) looks straight back along it.
	 */
	static get FACING() {
		return [Math.sin(YAW), 0, Math.cos(YAW)];
	}

	update(delta) {
		// Same exponential approach as the carved names: eases out by
		// construction, frame-rate independent.
		const k = 1 - Math.exp((-3 * delta) / HOVER_SECONDS);
		this.glow += ((this.hovered ? HOVER_GLOW : 0) - this.glow) * k;
		for (const part of this.parts) {
			if (part.glyphO) part.material.emissiveIntensity = this.glow;
		}
	}

	/**
	 * Centre and extent on screen, CSS pixels — as StepEngravings.anchors —
	 * plus `seen`: whether any of the word is in frame AND not behind the
	 * stair. Alexandre: the mark stays clickable as long as it can be seen,
	 * wherever the camera is, not only at the menu. Sampled on a 5 × 3 grid
	 * of the front face, each point raycast against the solid.
	 *
	 * @param {THREE.Camera} camera   the camera that DRAWS the frame
	 * @param {THREE.Mesh} occluder   the glyph
	 */
	anchors(camera, width, height, occluder) {
		this.group.updateMatrixWorld(true);
		const v = new THREE.Vector3();
		const box = new THREE.Box2();
		let behind = false;
		for (const corner of this.corners) {
			v.copy(corner).applyMatrix4(this.group.matrixWorld).project(camera);
			if (v.z > 1 || v.z < -1) behind = true;
			box.expandByPoint(
				new THREE.Vector2((v.x * 0.5 + 0.5) * width, (-v.y * 0.5 + 0.5) * height),
			);
		}
		const c = box.getCenter(new THREE.Vector2());
		const size = box.getSize(new THREE.Vector2());
		return {
			x: c.x,
			y: c.y,
			width: size.x,
			height: size.y,
			onScreen: !behind && c.x >= 0 && c.x <= width && c.y >= 0 && c.y <= height,
			seen: !behind && this.#seen(camera, occluder),
		};
	}

	#seen(camera, occluder) {
		const world = new THREE.Vector3();
		const ndc = new THREE.Vector3();
		const eye = new THREE.Vector3();
		for (const local of this.samples) {
			world.copy(local).applyMatrix4(this.group.matrixWorld);
			ndc.copy(world).project(camera);
			if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || Math.abs(ndc.z) > 1) continue;
			if (!occluder) return true;
			this.raycaster.setFromCamera(ndc, camera);
			const hit = this.raycaster.intersectObject(occluder, false)[0];
			// The ray's own distance to the sample, measured from where the
			// ray starts: an orthographic ray starts on the near plane.
			const reach = eye.copy(world).sub(this.raycaster.ray.origin).length();
			if (!hit || hit.distance > reach - 1e-3) return true;
		}
		return false;
	}

	dispose() {
		this.group.parent?.remove(this.group);
		for (const { mesh, material } of this.parts) {
			mesh.geometry.dispose();
			material.dispose();
		}
	}
}
