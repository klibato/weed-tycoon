/**
 * Vérifie qu'un nonce est strictement supérieur au last_nonce du joueur.
 * À appeler DANS la transaction qui mute le state, pour serialiser correctement.
 *
 * Throw une erreur avec code 'REPLAY' si le nonce est rejoué/trop vieux.
 * Throw 'INVALID_NONCE' si malformé.
 *
 * Si OK, met à jour last_nonce.
 */
export function checkAndBumpNonce( db, steamid, nonce ) {
	if ( !Number.isInteger( nonce ) || nonce <= 0 ) {
		const e = new Error( "Invalid nonce" );
		e.code = "INVALID_NONCE";
		throw e;
	}

	const row = db
		.prepare( "SELECT last_nonce FROM players WHERE steamid = ?" )
		.get( steamid );

	if ( !row ) {
		const e = new Error( "Player not found" );
		e.code = "NO_PLAYER";
		throw e;
	}

	if ( nonce <= row.last_nonce ) {
		const e = new Error( `Replay detected (got ${nonce}, last was ${row.last_nonce})` );
		e.code = "REPLAY";
		throw e;
	}

	db.prepare(
		"UPDATE players SET last_nonce = ?, updated_at = strftime('%s','now') WHERE steamid = ?"
	).run( nonce, steamid );
}
