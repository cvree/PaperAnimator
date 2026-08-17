/**
 * Installs the pdf.js compatibility shims on the main thread.
 *
 * The shims themselves live in realmShims.js, as plain JavaScript, because the
 * same source is also injected into the pdf.js worker realm — see
 * extract/pdf.ts. Keeping one copy means the two realms cannot drift apart.
 */
import './realmShims.js';

export {};
