import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Signe un payload (string ou Buffer) avec le HMAC_RESPONSE_SECRET.
 * Le client s&box peut vérifier la signature pour s'assurer que la réponse
 * vient bien du backend (pas d'un MITM).
 */
export function signPayload( payload ) {
	const data = typeof payload === "string" ? payload : JSON.stringify( payload );
	return crypto
		.createHmac( "sha256", config.auth.hmacResponseSecret )
		.update( data )
		.digest( "hex" );
}

/**
 * Vérifie une signature reçue d'un client (utilisé si on veut un signed-payload
 * comme alternative au JWT, ex: en cas de problème avec Sandbox.Http headers).
 */
export function verifySignature( payload, signature ) {
	const expected = signPayload( payload );
	const a = Buffer.from( expected, "hex" );
	const b = Buffer.from( signature ?? "", "hex" );
	if ( a.length !== b.length ) return false;
	return crypto.timingSafeEqual( a, b );
}
