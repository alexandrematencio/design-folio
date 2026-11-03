import * as THREE from "three";

/**
 * Film grain over the whole frame, as the last thing drawn.
 *
 * One pass for everything, not a line in each material: grain that lives in
 * the materials stops wherever a material does, and the seam between the
 * floor and the cove showed as a band. A quad that covers the clip space,
 * after every opaque and transparent object, without depth.
 *
 * It MULTIPLIES what is already there, by 1 + n with n in ±amount/2:
 * blending sees the canvas's encoded values, so this is a share of the
 * displayed value, like the density of an emulsion — it lives in the
 * mid-tones and the blue, and fades out on pure black and on the white the
 * paper clips to. Luminance only, a new pattern every frame unless the seed
 * is held.
 *
 * `amount` is a { value } the caller ramps; at 0 the quad is not drawn at
 * all, so a frame without grain is the frame as it was.
 */
export function createFilmGrain({ amount, seed }) {
	const material = new THREE.ShaderMaterial({
		uniforms: { uAmount: amount, uSeed: seed },
		vertexShader: /* glsl */ `
			void main() {
				gl_Position = vec4( position.xy * 2.0, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uAmount;
			uniform float uSeed;
			void main() {
				vec2 p = floor( gl_FragCoord.xy ) + vec2( 37.0, 17.0 ) * uSeed;
				float n = fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
				// Blended as src * dst + dst * src = dst * 2 * src:
				// src = ( 1 + n * amount ) / 2.
				gl_FragColor = vec4( vec3( 0.5 + 0.5 * n * uAmount ), 1.0 );
			}
		`,
		blending: THREE.CustomBlending,
		blendEquation: THREE.AddEquation,
		blendSrc: THREE.DstColorFactor,
		blendDst: THREE.SrcColorFactor,
		depthTest: false,
		depthWrite: false,
		transparent: true,
		toneMapped: false,
	});
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
	mesh.frustumCulled = false;
	mesh.renderOrder = Infinity;
	mesh.name = "film-grain";
	mesh.visible = false;
	return {
		mesh,
		update() {
			mesh.visible = amount.value > 0;
		},
		dispose() {
			mesh.geometry.dispose();
			material.dispose();
		},
	};
}
