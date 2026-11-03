import * as THREE from "three";

/**
 * A SOFTBOX'S SHADOW: sharp where the object touches, opening up away from it.
 *
 * Alexandre, 2026-11-03: is the stair's shadow realistic, should it be more
 * diffuse? It was not. three's VSM blurs the whole map by one radius, so the
 * shadow had the same edge everywhere — about 0.2 units, 10–90 %, at the foot
 * of the stair and four units further out alike. A real area light does not
 * do that: the penumbra grows with the distance between the occluder and the
 * surface it shades, by the light's size over its distance. The studio's key
 * (tools/bake-glyph-studio.py) is a 6-unit box 14 units away, so 0.43 units
 * of penumbra per unit of gap: a knife edge at the stair's foot, well over a
 * unit where the top edge's shadow reaches the AAXLO mark — wider than a
 * letter is tall.
 *
 * This is PCSS on top of the VSM moments three already renders:
 *   1. blocker search — the mean depth of what stands between the light and
 *      this point, from the moments around it;
 *   2. penumbra = (receiver − blocker) × K, in the map's own units;
 *   3. Chebyshev's test, as three does it, averaged over a disc that wide.
 * The map's own blur (shadow.radius) drops to a couple of texels: it is now
 * only the floor of the penumbra, not the penumbra.
 *
 * K IS SCALE-FREE, which is why it is a constant and not a uniform. The key
 * is directional: its shadow camera is orthographic, `radius` wide on each
 * side and `radius × 6` deep (Scene.js #addRoom), so a depth step of Δz in
 * the map is Δz·6r world units along the light, and a UV step of Δu is Δu·2r
 * across it. Penumbra width in UV = Δz·6r·(6/14) / 2r = Δz × 1.29, whatever r the
 * viewport gives the room. (The near plane of 1 is a part in 6r, ignored.)
 *
 * Global: it rewrites the chunk every material of the page compiles from, so
 * it is installed only on the pages that have the studio (Scene.js), before
 * the first compile. The floor, the stair and the AAXLO mark then read one
 * and the same shadow, which is the point.
 */

// Softbox size over distance, times the shadow camera's depth over width,
// halved: the filter disc is sampled by its RADIUS, the penumbra is its
// width. (Read as a radius, the first try spread every shadow twice over.)
const K = ((6 / 14) * (6 / 2)) / 2;
// The widest penumbra radius, UV of the map, and the blocker search's reach.
// On the widest viewport the room is ~25 world units in radius, so 0.03 is
// 1.5 units of radius: the stair's top edge over the farthest floor it
// shades (about 5 units of gap, 1 unit of radius) stays inside it.
const SEARCH = 0.03;
// The narrowest, so the contact never aliases into the map's texels.
const MIN_PENUMBRA = 0.0012;
// What counts as standing in front: a gap of more than this, map depth
// (the room is 6r deep, so about a hundredth of a stair's height).
const GAP = 0.0004;
// The steepest receiver plane trusted, depth per UV.
const MAX_SLOPE = 4;
const BLOCKER_TAPS = 12;
const FILTER_TAPS = 20;

const CONTACT_VSM = /* glsl */ `
	float contactIgn( vec2 p ) {
		return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
	}

	vec2 contactVogel( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float t = float( i ) * 2.399963229728653 + phi;
		return vec2( cos( t ), sin( t ) ) * r;
	}

	float contactChebyshev( sampler2D shadowMap, vec2 uv, float z ) {
		vec2 m = texture2D( shadowMap, uv ).rg;
		if ( z <= m.x ) return 1.0;
		float variance = max( m.y * m.y, 0.0000001 );
		float d = z - m.x;
		float p = variance / ( variance + d * d );
		return clamp( ( p - 0.3 ) / 0.65, 0.0, 1.0 );
	}

	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

		float shadow = 1.0;

		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;

		// RECEIVER PLANE. The floor is seen by the key at a slant, so its own
		// depth changes across the disc: a tap three units up the slope is
		// nearer the light than this point without anything being in the
		// way. Every tap is compared with the depth the receiver's own plane
		// has there, from the screen-space derivatives — taken here, before
		// any branch, where they are defined.
		vec3 sx = dFdx( shadowCoord.xyz );
		vec3 sy = dFdy( shadowCoord.xyz );
		float det = sx.x * sy.y - sx.y * sy.x;
		vec2 slope = abs( det ) > 1e-12
			? vec2( sy.y * sx.z - sx.y * sy.z, sx.x * sy.z - sy.x * sx.z ) / det
			: vec2( 0.0 );
		// A grazing receiver would extrapolate its plane wildly.
		slope = clamp( slope, vec2( - ${MAX_SLOPE.toFixed(2)} ), vec2( ${MAX_SLOPE.toFixed(2)} ) );

		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;

		if ( frustumTest ) {

			float phi = contactIgn( gl_FragCoord.xy ) * 6.28318530718;
			float z = shadowCoord.z;

			// 1. What stands in front, and how far in front.
			float blocker = 0.0;
			float found = 0.0;
			for ( int i = 0; i < ${BLOCKER_TAPS}; i ++ ) {
				vec2 o = contactVogel( i, ${BLOCKER_TAPS}, phi ) * ${SEARCH.toFixed(4)};
				float m = texture2D( shadowMap, shadowCoord.xy + o ).r;
				if ( m < z + dot( slope, o ) - ${GAP.toFixed(4)} ) { blocker += m; found += 1.0; }
			}

			if ( found > 0.0 ) {

				blocker /= found;

				// 2. The softbox's penumbra at that gap.
				float penumbra = clamp( ( z - blocker ) * ${K.toFixed(4)}, ${MIN_PENUMBRA.toFixed(4)}, ${SEARCH.toFixed(4)} );

				// 3. Chebyshev over that disc, each tap against the plane.
				shadow = 0.0;
				for ( int i = 0; i < ${FILTER_TAPS}; i ++ ) {
					vec2 o = contactVogel( i, ${FILTER_TAPS}, phi ) * penumbra;
					shadow += contactChebyshev( shadowMap, shadowCoord.xy + o, z + dot( slope, o ) );
				}
				shadow /= ${FILTER_TAPS}.0;

			}

		}

		return mix( 1.0, shadow, shadowIntensity );

	}
`;

let installed = false;

/** Swap three's VSM getShadow for the contact-hardening one. Idempotent. */
export function installContactShadows() {
	if (installed) return;
	const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
	// three's own VSM function is kept, renamed out of the way, and ours goes
	// in front of it inside the same #elif. Matched on code, not comments:
	// the built three.module.js strips them.
	const marker = "#elif defined( SHADOWMAP_TYPE_VSM )";
	const start = chunk.indexOf(marker);
	const fn = start < 0 ? -1 : chunk.indexOf("float getShadow(", start);
	if (start < 0 || fn < 0) {
		// A three upgrade moved the chunk: keep its own shadow, say so.
		console.warn("contactShadow: VSM chunk not found, three's shadow kept");
		return;
	}
	const at = start + marker.length;
	THREE.ShaderChunk.shadowmap_pars_fragment =
		chunk.slice(0, at) +
		"\n" +
		CONTACT_VSM +
		chunk.slice(at, fn) +
		"float threeVsmShadow(" +
		chunk.slice(fn + "float getShadow(".length);
	installed = true;
}
