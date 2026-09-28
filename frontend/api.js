// Thin wrapper around the FreeFinder backend: the public.ff_* functions in
// backend/schema.sql, called through Supabase's REST endpoint /rest/v1/rpc/<fn>.
const api = {
  code: null, // the signed-in person's three-word code, kept in memory only

  configured(){
    return !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.startsWith('YOUR-');
  },

  async rpc(fn, args){
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
    // Legacy anon keys are JWTs and also go in Authorization; new publishable keys don't.
    if(SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SUPABASE_KEY;
    let res;
    try{
      res = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      });
    }catch(e){
      throw new Error("Can't reach the server.");
    }
    const data = await res.json().catch(() => null);
    if(!res.ok) throw new Error((data && data.message) || 'Something went wrong.');
    if(data && data.error) throw new Error(data.error);
    return data;
  },

  // Name box: returns {new:true, name} for a name, or {account} for a valid code.
  login(input){ return this.rpc('ff_login', { p_input: input }); },
  createAccount(name, free){ return this.rpc('ff_create_account', { p_name: name, p_free: free }); },
  getAccount(){ return this.rpc('ff_get_account', { p_code: this.code }); },
  saveFree(free){ return this.rpc('ff_update_account', { p_code: this.code, p_free: free }); },
  deleteAccount(){ return this.rpc('ff_delete_account', { p_code: this.code }); },
  // People I follow (I entered their code).
  follow(targetCode){ return this.rpc('ff_request_follow', { p_code: this.code, p_target_code: targetCode }); },
  unfollow(ownerId){ return this.rpc('ff_unfollow', { p_code: this.code, p_owner_id: ownerId }); },
  // People who entered my code.
  approveViewer(viewerId){ return this.rpc('ff_approve_viewer', { p_code: this.code, p_viewer_id: viewerId }); },
  removeViewer(viewerId){ return this.rpc('ff_remove_viewer', { p_code: this.code, p_viewer_id: viewerId }); },
};
