import { config } from "../config.js";

/**
 * Vérifie un Steam auth ticket via l'API Web Steam.
 * En mode bypass (dev), accepte n'importe quel ticket et renvoie la steamid passée.
 *
 * Référence : https://partner.steamgames.com/doc/webapi/ISteamUserAuth
 */
export async function verifySteamTicket( { ticket, claimedSteamId } ) {
	if ( config.steam.bypassAuth ) {
		// Mode dev — accepte tout. NE JAMAIS utiliser en production.
		if ( !claimedSteamId ) throw new Error( "claimedSteamId required in bypass mode" );
		return { steamid: String( claimedSteamId ), bypassed: true };
	}

	if ( !config.steam.apiKey ) {
		throw new Error( "STEAM_API_KEY missing — cannot verify ticket without bypass mode" );
	}
	if ( !config.steam.appId ) {
		throw new Error( "STEAM_APP_ID missing" );
	}
	if ( !ticket ) {
		throw new Error( "ticket required" );
	}

	const url = new URL( "https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/" );
	url.searchParams.set( "key", config.steam.apiKey );
	url.searchParams.set( "appid", String( config.steam.appId ) );
	url.searchParams.set( "ticket", ticket );

	const res = await fetch( url );
	if ( !res.ok ) throw new Error( `Steam API HTTP ${res.status}` );

	const data = await res.json();
	const params = data?.response?.params;
	if ( !params || params.result !== "OK" ) {
		throw new Error( `Steam ticket invalid: ${params?.error ?? "no params"}` );
	}
	if ( params.vacbanned || params.publisherbanned ) {
		throw new Error( "Banned account" );
	}

	return { steamid: String( params.steamid ), bypassed: false };
}
