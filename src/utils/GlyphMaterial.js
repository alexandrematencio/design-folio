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
	},
) {
	const wells = bounce !== null;

	const uniforms = {
		uLitness: litness,
		uFlatPaper: { value: new THREE.Color(paper) },
		uFlatCobalt: { value: new THREE.Color(cobalt) },
	};

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
			uniform vec3 uFlatPaper;
			uniform vec3 uFlatCobalt;
			varying vec3 vGlyphObjectNormal;
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

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <opaque_fragment>",
			`#include <opaque_fragment>
			// The extrusion runs along Z in glTF space, so a tread is a face
			// whose normal points along Y. The 0.5 cutoff sends the 0.012
			// chamfer to whichever side it leans toward — roughly a pixel at
			// the logo's native size, and it keeps the edges crisp.
			float _isTread = step( 0.5, abs( normalize( vGlyphObjectNormal ).y ) );
			vec3 _flat = mix( uFlatCobalt, uFlatPaper, _isTread );
			vec3 _lit = gl_FragColor.rgb;
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
		wells ? "glyph-one-material" : "glyph-two-tone";
	material.needsUpdate = true;

	return uniforms;
}
