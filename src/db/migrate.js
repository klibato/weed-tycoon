import { applyMigrations, db } from "./index.js";

console.log( "[migrate] Applying schema..." );
applyMigrations();
console.log( "[migrate] Done. Tables :" );
const tables = db
	.prepare( "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" )
	.all()
	.map( r => r.name );
console.log( tables.join( ", " ) );
