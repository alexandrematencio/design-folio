import * as THREE from "three";

/**
 * Projects a texture onto any lit material as if a slide projector were
 * standing in world space at a fixed spot. Same family as
 * three-projected-material (github.com/marcofugaro/three-projected-material),
 * but written as an onBeforeCompile patch so the host material keeps its own
 * lighting, env map and clearcoat untouched.
 *
 * This is the whole anamorphosis. The projector camera is a frozen copy of
 * the render camera at its rest pose: while the two coincide, every surface
 * shows exactly the pixel the flat page would have shown there, and the scene
 * reads as a 2D document. Move the render camera and the geometry underneath
 * the ink is suddenly visible.
 *
 * uLitness is the second half of the trick: at 0 the shaded result is thrown
 * away and only the flat projected colour survives — no shadow, no gradient,
 * nothing that could betray a third dimension. It is shared with the glyph
 * material so page and logo leave flatland on the same curve.
 *
 * One projector drives many meshes; they share uniforms, so update() once.
 */
export function createProjector({ camera, texture, litness, pageOpacity }) {
	const uniforms = {
		projectedTexture: { value: texture },
		projectorViewMatrix: { value: new THREE.Matrix4() },
		projectorProjectionMatrix: { value: new THREE.Matrix4() },
		projectorPosition: { value: new THREE.Vector3() },
		projectorDirection: { value: new THREE.Vector3(0, 0, 1) },
		projectorIsOrtho: { value: camera.isOrthographicCamera ? 1 : 0 },
		uLitness: litness,
		uPageOpacity: pageOpacity ?? { value: 1 },
	};

	function applyTo(mesh) {
		const material = mesh.material;
		if (!material) return;

		material.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, uniforms);

			shader.vertexShader = shader.vertexShader
				.replace(
					"#include <common>",
					`#include <common>
					uniform mat4 projectorViewMatrix;
					uniform mat4 projectorProjectionMatrix;
					uniform vec3 projectorPosition;
					uniform vec3 projectorDirection;
					uniform float projectorIsOrtho;
					varying vec4 vProjectedCoord;
					varying vec3 vProjectorDir;
					varying vec3 vProjectorNormal;
					`,
				)
				.replace(
					"#include <begin_vertex>",
					`#include <begin_vertex>
					vec4 _projWorld = modelMatrix * vec4( transformed, 1.0 );
					vProjectedCoord = projectorProjectionMatrix * projectorViewMatrix * _projWorld;
					// An orthographic projector has no position to point from:
					// every ray is parallel, so the direction is a constant.
					vProjectorDir = mix(
						normalize( projectorPosition - _projWorld.xyz ),
						projectorDirection,
						projectorIsOrtho
					);
					vProjectorNormal = normalize( mat3( modelMatrix ) * normal );
					`,
				);

			shader.fragmentShader = shader.fragmentShader
				.replace(
					"#include <common>",
					`#include <common>
					uniform sampler2D projectedTexture;
					uniform float uLitness;
					uniform float uPageOpacity;
					varying vec4 vProjectedCoord;
					varying vec3 vProjectorDir;
					varying vec3 vProjectorNormal;

					// NOTE: do NOT sRGB-decode _projTexel by hand. The canvas
					// texture is declared SRGBColorSpace, so three uploads it
					// as SRGB8_ALPHA8 and the sampler decodes in hardware —
					// texture2D() already returns linear. Decoding again is
					// silent and subtle: #FAFAF8 paper renders #F4F4EF and
					// #0A0A0A ink renders #010101. It reads as "a bit flat"
					// rather than as a bug, which is how it survives a review.
					`,
				)
				.replace(
					"#include <color_fragment>",
					`#include <color_fragment>
					vec3 _projNDC = vProjectedCoord.xyz / vProjectedCoord.w;
					vec2 _projUV = _projNDC.xy * 0.5 + 0.5;
					float _inFrustum = step( 0.0, _projUV.x ) * step( _projUV.x, 1.0 )
					                 * step( 0.0, _projUV.y ) * step( _projUV.y, 1.0 )
					                 * step( -1.0, _projNDC.z ) * step( _projNDC.z, 1.0 );
					// Back faces must not catch the beam, or the page prints
					// through the object mirror-imaged. The cyclorama is a
					// BackSide cylinder — we stand inside it — so its stored
					// normals point away from us and have to be flipped, or
					// the wall the page is meant to land on rejects it.
					vec3 _projNormal = gl_FrontFacing ? vProjectorNormal : -vProjectorNormal;
					float _facing = step( 0.0, dot( _projNormal, vProjectorDir ) );
					vec4 _projTexel = texture2D( projectedTexture, _projUV );
					float _mask = _inFrustum * _facing * _projTexel.a * uPageOpacity;
					diffuseColor.rgb = mix( diffuseColor.rgb, _projTexel.rgb, _mask );
					vec3 _flatDiffuse = diffuseColor.rgb;
					`,
				)
				.replace(
					"#include <opaque_fragment>",
					`#include <opaque_fragment>
					gl_FragColor.rgb = mix( _flatDiffuse, gl_FragColor.rgb, uLitness );
					`,
				);
		};

		// Two materials patched differently must not share a compiled program.
		material.customProgramCacheKey = () => "projected";
		material.needsUpdate = true;
	}

	function update() {
		camera.updateMatrixWorld();
		uniforms.projectorViewMatrix.value.copy(camera.matrixWorldInverse);
		uniforms.projectorProjectionMatrix.value.copy(camera.projectionMatrix);
		uniforms.projectorPosition.value.setFromMatrixPosition(camera.matrixWorld);
		// Surface toward projector, i.e. the reverse of where it looks.
		uniforms.projectorDirection.value
			.set(0, 0, 1)
			.applyQuaternion(camera.quaternion)
			.normalize();
		uniforms.projectorIsOrtho.value = camera.isOrthographicCamera ? 1 : 0;
	}

	return { applyTo, update, uniforms, camera };
}
