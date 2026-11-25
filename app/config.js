// Configuration publique de l'appli.
// L'URL du projet et la clé « anon » (publishable) de Supabase ne sont pas des secrets :
// elles sont faites pour le navigateur, et c'est la RLS qui protège les données.
// Ne mets JAMAIS ici la clé service_role ni la clé API Claude.
// Laisse vide pour utiliser l'appli en mode local (données sur cet appareil uniquement).
export const SUPABASE_URL = 'https://wpwpkyotypodhqtevois.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indwd3BreW90eXBvZGhxdGV2b2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1Njc1NDEsImV4cCI6MjExMTE0MzU0MX0.VmURDUn88LPiWzvEkk4zrKQ3EbKach5g_rXXSsxvn4k';
