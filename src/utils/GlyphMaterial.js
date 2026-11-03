import * as THREE from "three";

/**
 * The hero glyph wears two skins at once and crossfades between them on the
 * same uLitness the projected page uses.
 *
 *   uLitness 0 — flat, and byte-identical to glyph-alxmtnc.svg under the rest
 *                camera. No shading of any kind; the values are the vector
 *                file's own, read back off the solid.
 *   uLitness 1 — the real thing: a cobalt dielectric reflecting the studio
 *                built in studioEnvironment.js.
 *
 * TWO INKING RULES, and which one you get is the difference between the two
 * pages of this project.
 *
 * "two-tone" (index.html) — vertical faces cobalt, horizontal faces paper.
 * That is the rule the SVG is usually read with, and it is 99.1 % right.
 *
 * "one-material" (v2.html) — the rule Alexandre actually drew with. The solid
 * is cobalt EVERYWHERE; there is no white paint on it, and every tint that is
 * not the pigment is a REFLECTION, pinned to the mirror direction so that it
 * slides across the faces as the visitor orbits:
 *
 *   the WHITE is the ceiling. Whichever face's mirror direction points up
 *   shows it — at the rest angle that is the treads, exactly the faces the
 *   SVG blows out, and a quarter turn later it is whoever has turned into
 *   that angle instead.
 *
 *   the COBALT is the pigment, lit by the lamps and by as much of the sky as
 *   the bake says each vertex can actually see. The environment map no longer
 *   lights anything diffusely on this rule (uEnvDiffuse 0 by default): it is
 *   a mirror, not a lamp, and the position-aware light lives in the baked
 *   attributes instead.
 *
 *   the PALE WEDGE is the floor. The studio now has one — bright, the same
 *   white as the rest of the room — and the wedge under the bottom step
 *   mirrors it, at the same Fresnel angle as everything else. Because it is a
 *   reflection and not a veil, it lives and dies with the view: turn away
 *   from the rest pose and the pallor slides off the face, leaving shaded
 *   blue, the same way the treads' white leaves them.
 *
 * ONE GATE IS NOT PHYSICS, and it is measured to be necessary. Trace the
 * mirror of the rest view against the solid itself and the step fronts and
 * the bottom riser ALSO reflect the floor, over 100 % of their area — the
 * same floor, the same angle. Let them show it and the whole logo washes to
 * lavender; that wash was measured before the floor was gated. No physically
 * consistent room makes the pocket pale AND the fronts cobalt, yet the
 * drawing does exactly that. So the drawing's rule is applied to the real
 * reflection: only the faces the bake marks as sealed off from the sky
 * (aWell — the wedge and the rest of the pocket) may show the floor's mirror
 * image. The MEASUREMENT picks the faces; the LIGHT is the room's own.
 *
 * THE STUDIO (one-material only, opt-in). Everything above is the perfect
 * light, and at rest it has to be: the logo is flat. The moment the camera
 * moves it is also what gives the 3D away — every face one value, nothing
 * darkening into a corner, the riser and the side face on the same blue.
 * `studio` is a Cycles bake of a photographer's studio — a softbox at a real
 * distance, swung to one side (tools/bake-glyph-studio.py) — sampled in the
 * lightmap UVs, and uStudio fades it in with the travel: the stair leaves the
 * perfect light for a real studio as the visitor leaves the rest pose. Red is
 * the diffuse, the studio over the rig, taken whole: the faces part, the
 * corners close in. Green is occlusion alone, and the reflections take only
 * `specular` of it — a mirror sees the room, not the lamp, and a corner dims
 * a reflection less than it dims a lamp. Then the thread of light along each
 * convex edge (studio.edges, from the same bake): the tenth-of-a-millimetre
 * bevel every real edge has, measured exactly per pixel against the edge's
 * segment, box-filtered over the pixel so it thins to a fade rather than
 * breaking up, and reflecting the room in the direction that bevel faces —
 * white where it turns to the softbox, nothing where it turns to the dark.
 * All of it on uStudio: at rest there is no shade and no thread.
 *
 * The tread rule uses the OBJECT-space normal, not the world one. "Horizontal"
 * is a property of the solid — which faces are treads — and must not change if
 * the glyph is ever turned.
 */
export function patchGlyphMaterial(
	material,
	{
		litness,
		paper,
		cobalt,
		bounce = null,
		// How much the environment map is allowed to act as a LAMP, not a
		// mirror. The ceiling's radiance sits far above 1 so that a tread can
		// clip white through the clearcoat, and three pours that same map into
		// the diffuse irradiance, where it buries every other light: cobalt's
		// blue channel is already 1.0, so any irradiance over unity crushes
		// every face to the same value. Here it is gated per vertex by the
		// baked sky visibility, so it lights only what actually sees the room.
		envDiffuse = 0,
		// White light bouncing up off the cyclorama floor, weighted per vertex
		// by how much of that floor the vertex can actually see. This is the
		// DIFFUSE half of "le blanc éclaire par le dessous"; the specular half
		// is the floor's mirror image, gated below.
		groundBounce = 0,
		// Where the highlight roll-off begins, in linear light. The renderer
		// runs NoToneMapping so that the projected page stays byte-exact, so
		// the glyph carries its own shoulder: below the knee nothing moves
		// (cobalt's blue channel at 1.0 lands within a step of #0013FF),
		// above it the overshoot is folded into the last few per cent instead
		// of clipping at a hard edge. A softbox reflection then ends the way
		// film ends it — a roll into white — rather than as a cut-out. 1
		// disables it (pure clip).
		knee = 1,
		// { map, range, amount: { value }, contrast, specular, edges, edge }
		// — see THE STUDIO.
		studio = null,
	},
) {
	const wells = bounce !== null;

	const uniforms = {
		uLitness: litness,
		uFlatPaper: { value: new THREE.Color(paper) },
		uFlatCobalt: { value: new THREE.Color(cobalt) },
	};

	uniforms.uKnee = { value: knee };

	const baked = studio !== null;
	// Each edge as two vec4: its ends, and in w the two faces it joins, as
	// axis codes (+-1 +-2 +-3 for +-x +-y +-z).
	const edges = studio?.edges ?? [];
	const edgeA = edges.map((e) => new THREE.Vector4(e[0], e[1], e[2], e[6]));
	const edgeB = edges.map((e) => new THREE.Vector4(e[3], e[4], e[5], e[7]));
	const threaded = edges.length > 0;
	// The feet, the same way: the inside corners where an upright face stands
	// on a tread and the bottom edges standing on the floor, each with the two
	// faces that darken toward it (THE CONTACT CORE, below).
	const feet = (studio?.contact && studio?.feet) ?? [];
	const footA = feet.map((e) => new THREE.Vector4(e[0], e[1], e[2], e[6]));
	const footB = feet.map((e) => new THREE.Vector4(e[3], e[4], e[5], e[7]));
	const footed = feet.length > 0;
	if (baked) {
		Object.assign(uniforms, {
			uStudioMap: { value: studio.map },
			uStudioRange: { value: studio.range },
			uStudio: studio.amount,
			uStudioSpecular: { value: studio.specular ?? 0.5 },
			uStudioContrast: { value: studio.contrast ?? 1 },
			uStudioEdge: { value: studio.edge ?? 1 },
			uEdgeA: { value: edgeA },
			uEdgeB: { value: edgeB },
		});
		if (footed) {
			Object.assign(uniforms, {
				uFootA: { value: footA },
				uFootB: { value: footB },
				uContactDensity: { value: studio.contact.density },
				uContactReach: { value: studio.contact.reach },
			});
		}
	}

	if (wells) {
		Object.assign(uniforms, {
			uFlatBounce: { value: new THREE.Color(bounce) },
			uEnvDiffuse: { value: envDiffuse },
			uGroundBounce: { value: groundBounce },
		});
	}

	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);

		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
				varying vec3 vGlyphObjectNormal;
				${
					baked
						? `attribute vec2 aStudioUv;
				varying vec2 vStudioUv;
				varying vec3 vEdgeObject;
				varying vec3 vEdgeX;
				varying vec3 vEdgeY;
				varying vec3 vEdgeZ;`
						: ""
				}
				${
					wells
						? `attribute float aSkyVis;
				attribute float aGroundVis;
				attribute float aWell;
				varying float vSkyVis;
				varying float vGroundVis;
				varying float vWell;`
						: ""
				}
				`,
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
				vGlyphObjectNormal = normal;
				${
					baked
						? `vStudioUv = aStudioUv;
				// The edges are in object space; the bevel normal is built
				// there and taken to view space through the object's axes.
				vEdgeObject = position;
				vEdgeX = normalMatrix * vec3( 1.0, 0.0, 0.0 );
				vEdgeY = normalMatrix * vec3( 0.0, 1.0, 0.0 );
				vEdgeZ = normalMatrix * vec3( 0.0, 0.0, 1.0 );`
						: ""
				}
				${
					wells
						? `vSkyVis = aSkyVis;
				vGroundVis = aGroundVis;
				vWell = aWell;`
						: ""
				}
				`,
			);

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <common>",
			`#include <common>
			uniform float uLitness;
			uniform float uKnee;
			uniform vec3 uFlatPaper;
			uniform vec3 uFlatCobalt;
			varying vec3 vGlyphObjectNormal;
			${
				baked
					? `uniform sampler2D uStudioMap;
			uniform float uStudioRange;
			uniform float uStudio;
			uniform float uStudioSpecular;
			uniform float uStudioContrast;
			uniform float uStudioEdge;
			varying vec2 vStudioUv;
			varying vec3 vEdgeObject;
			varying vec3 vEdgeX;
			varying vec3 vEdgeY;
			varying vec3 vEdgeZ;
			${
				threaded
					? `#define EDGE_COUNT ${edges.length}
			uniform vec4 uEdgeA[ EDGE_COUNT ];
			uniform vec4 uEdgeB[ EDGE_COUNT ];
			vec3 edgeFace( float code ) {
				float a = abs( code );
				return sign( code ) * vec3( step( abs( a - 1.0 ), 0.5 ), step( abs( a - 2.0 ), 0.5 ), step( abs( a - 3.0 ), 0.5 ) );
			}`
					: ""
			}
			${
				footed
					? `#define FOOT_COUNT ${feet.length}
			uniform vec4 uFootA[ FOOT_COUNT ];
			uniform vec4 uFootB[ FOOT_COUNT ];
			uniform float uContactDensity;
			uniform float uContactReach;
			vec3 footFace( float code ) {
				float a = abs( code );
				return sign( code ) * vec3( step( abs( a - 1.0 ), 0.5 ), step( abs( a - 2.0 ), 0.5 ), step( abs( a - 3.0 ), 0.5 ) );
			}`
					: ""
			}`
					: ""
			}
			// Per channel: identity up to the knee, then an exponential
			// shoulder that approaches 1 and never crosses it. Per channel
			// ON PURPOSE — a hue-preserving curve would keep a blown tread
			// pale blue forever, and the logo's white IS the desaturation.
			vec3 glyphShoulder( vec3 c ) {
				float k = uKnee;
				if ( k >= 1.0 ) return c;
				vec3 over = max( c - k, 0.0 );
				vec3 shoulder = k + ( 1.0 - k ) * ( 1.0 - exp( - over / ( 1.0 - k ) ) );
				return mix( c, shoulder, step( k, c ) );
			}
			${
				wells
					? `uniform vec3 uFlatBounce;
			uniform float uEnvDiffuse;
			uniform float uGroundBounce;
			varying float vSkyVis;
			varying float vGroundVis;
			varying float vWell;`
					: ""
			}
			`,
		);

		if (wells) {
			// The HemisphereLight is the sky, and the sky is exactly what the
			// bake measured — so its irradiance is scaled by the ratio of the
			// sky each vertex sees to the sky its normal could see unoccluded
			// (0.5 + 0.5 * N.y, the cosine-weighted upper cap). An open tread
			// keeps its light untouched; the wedge, at 0.03 of a possible
			// 0.5, drops to six per cent and finally sits in the shadow of
			// the staircase, which no shadow map was ever going to give an
			// ambient light. The chunk has to be inlined to be edited:
			// onBeforeCompile runs before three resolves the #includes.
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <lights_fragment_begin>",
				THREE.ShaderChunk.lights_fragment_begin
					.replace(
						"vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );",
						`vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
						// Every lamp in this studio lives in the sky, so a vertex
						// receives them in proportion to the sky it can see: the
						// baked visibility over the cosine-weighted upper cap its
						// normal could see unoccluded. An open riser keeps 98 % of
						// its light; the wedge, at 0.03 of a possible 0.5, keeps
						// six per cent — and the key light can no longer leak
						// through the soft shadow map into the pocket, because it
						// is gated by geometry that was ray-cast, not filtered.
						float _roomVis = clamp( vSkyVis / max( 0.5 + 0.5 * inverseTransformDirection( geometryNormal, viewMatrix ).y, 0.05 ), 0.0, 1.0 );`,
					)
					.replace(
						"getDirectionalLightInfo( directionalLight, directLight );",
						`getDirectionalLightInfo( directionalLight, directLight );
						directLight.color *= _roomVis;`,
					)
					.replace(
						"irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );",
						"irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * _roomVis;",
					),
			);

			// iblIrradiance and radiance are separate variables in three, which
			// is the whole reason this can be surgical: the room keeps its
			// mirror and loses its lamp, at the one point in the pipeline
			// where the two are still apart. Then the mirror itself is gated
			// by what the reflected direction could actually be seeing:
			// upward reflections by the baked sky visibility, downward ones
			// by the well selector — the one drawn rule (see the header).
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <lights_fragment_maps>",
				`#include <lights_fragment_maps>
				#if defined( RE_IndirectDiffuse )
					// The room-as-lamp, squared on the same ratio: the map's
					// brightness lives at the ZENITH, and what little sky the
					// wedge still sees is the dim rim past the overhang, never
					// the ceiling. Squaring is that correction — an open face
					// barely notices it, a sealed one loses the lamp entirely.
					iblIrradiance *= uEnvDiffuse * _roomVis * _roomVis;
					irradiance += vec3( uGroundBounce * vGroundVis );
				#endif
				#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
				{
					vec3 _mirror = inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix );
					float _above = smoothstep( -0.15, 0.15, _mirror.y );
					float _sees = mix( vWell, smoothstep( 0.02, 0.20, vSkyVis ), _above );
					radiance *= _sees;
					#ifdef USE_CLEARCOAT
						clearcoatRadiance *= _sees;
					#endif
				}
				#endif
				`,
			);
		}

		if (baked) {
			// After every light is in and before the layers are summed: the
			// one point where diffuse, reflection and lacquer are still apart.
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <aomap_fragment>",
				`#include <aomap_fragment>
				{
					// A power, not a gain: it deepens the shade and leaves the
					// lit face — 1 — exactly where it was.
					vec2 _bake = pow( texture2D( uStudioMap, vStudioUv ).rg * uStudioRange, vec2( uStudioContrast ) );
					float _d = mix( 1.0, _bake.r, uStudio );

					// THE CONTACT CORE. The bake has the corner's spread; at
					// the very foot of an upright face — on the floor, on the
					// tread it stands on — a real one goes dense and falls off
					// fast, then hands over to that spread: exp(-d / reach),
					// from the exact distance to the nearest foot this face
					// belongs to (the floor reads the same curve from its map).
					#ifdef FOOT_COUNT
					{
						vec3 _fn = normalize( vGlyphObjectNormal );
						float _fd = 1e3;
						for ( int i = 0; i < FOOT_COUNT; i ++ ) {
							if ( max( dot( footFace( uFootA[ i ].w ), _fn ), dot( footFace( uFootB[ i ].w ), _fn ) ) < 0.5 ) continue;
							vec3 _a = uFootA[ i ].xyz;
							vec3 _ab = uFootB[ i ].xyz - _a;
							float _t = clamp( dot( vEdgeObject - _a, _ab ) / dot( _ab, _ab ), 0.0, 1.0 );
							_fd = min( _fd, length( vEdgeObject - _a - _t * _ab ) );
						}
						_d *= mix( 1.0, 1.0 - uContactDensity * exp( - _fd / uContactReach ), uStudio );
					}
					#endif
					reflectedLight.directDiffuse *= _d;
					reflectedLight.indirectDiffuse *= _d;
					float _s = mix( 1.0, min( _bake.g, 1.0 ), uStudio * uStudioSpecular );
					reflectedLight.directSpecular *= _s;
					reflectedLight.indirectSpecular *= _s;
					#ifdef USE_CLEARCOAT
						clearcoatSpecularDirect *= _s;
						clearcoatSpecularIndirect *= _s;
					#endif

					// THE THREAD. The nearest convex edge of this face —
					// one the face itself runs along: its bevel leans toward
					// this face's normal — and the exact distance to it.
					#if defined( EDGE_COUNT ) && defined( USE_ENVMAP )
					if ( uStudio > 0.0 ) {
						vec3 _faceN = normalize( vGlyphObjectNormal );
						float _ed = 1e3;
						vec3 _bevel = _faceN;
						for ( int i = 0; i < EDGE_COUNT; i ++ ) {
							vec3 _bv = normalize( edgeFace( uEdgeA[ i ].w ) + edgeFace( uEdgeB[ i ].w ) );
							if ( dot( _bv, _faceN ) < 0.5 ) continue;
							vec3 _a = uEdgeA[ i ].xyz;
							vec3 _ab = uEdgeB[ i ].xyz - _a;
							float _t = clamp( dot( vEdgeObject - _a, _ab ) / dot( _ab, _ab ), 0.0, 1.0 );
							float _d = length( vEdgeObject - _a - _t * _ab );
							if ( _d < _ed ) { _ed = _d; _bevel = _bv; }
						}
						// A strip WIDTH wide, box-filtered over the pixel:
						// under a pixel it fades instead of breaking up.
						const float WIDTH = 0.006;
						float _px = max( fwidth( _ed ), 1e-5 );
						float _line = clamp( ( WIDTH + 0.5 * _px - _ed ) / _px, 0.0, 1.0 ) * min( 1.0, WIDTH / _px );
						if ( _line > 0.0 ) {
							vec3 _bn = normalize( _bevel.x * vEdgeX + _bevel.y * vEdgeY + _bevel.z * vEdgeZ );
							float _fresnel = 0.04 + 0.96 * pow( 1.0 - saturate( dot( _bn, geometryViewDir ) ), 5.0 );
							reflectedLight.indirectSpecular += getIBLRadiance( geometryViewDir, _bn, 0.12 )
								* _fresnel * _line * uStudioEdge * uStudio;
						}
					}
					#endif
				}
				`,
			);
		}

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <opaque_fragment>",
			`#include <opaque_fragment>
			// The extrusion runs along Z in glTF space, so a tread is a face
			// whose normal points along Y. The 0.5 cutoff sends the 0.012
			// chamfer to whichever side it leans toward — roughly a pixel at
			// the logo's native size, and it keeps the edges crisp.
			float _isTread = step( 0.5, abs( normalize( vGlyphObjectNormal ).y ) );
			vec3 _flat = mix( uFlatCobalt, uFlatPaper, _isTread );
			vec3 _lit = glyphShoulder( gl_FragColor.rgb );
			${
				wells
					? `_flat = mix( _flat, uFlatBounce, vWell );`
					: ""
			}
			gl_FragColor.rgb = mix( _flat, _lit, uLitness );
			`,
		);
	};

	material.customProgramCacheKey = () =>
		(wells ? "glyph-one-material" : "glyph-two-tone") + (baked ? "-studio" : "");
	material.needsUpdate = true;

	return uniforms;
}
