// Public settings for the hosted site. The publishable key is designed to be public: what each user can read or
// change is enforced by row-level security in Supabase (supabase/schema.sql). Never put the service_role key here.
window.BC_CONFIG = {
  supabaseUrl: "https://fvkqmiimmsecydlzrdbw.supabase.co",
  supabaseKey: "sb_publishable_pbds6_5ej6l09byksTC9mQ_M5mhjaPi",
  // usernames sign in as <username>@<emailDomain> (accounts are created in the Supabase dashboard)
  emailDomain: "battle-companion.app",
};
