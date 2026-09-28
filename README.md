# freefinder
find your frees! 

- New? Type your name, tick your frees (including lunch and after school), and you'll get a three-word secret code like `apple.river.stone`.
- Coming back? Type your code into the name box to get your saved frees.
- Give your code to friends. When they add it, you get a request — they can only see your frees once you approve, and you can take that back any time.
- The Calendar tab shows all your approved friends' frees for the week at once.

## Hosting it (GitHub Pages + Supabase, both free)

The site is plain HTML/JS served by GitHub Pages. The data lives in a free [Supabase](https://supabase.com) database.

1. **Make the database.** Create a Supabase project. Open **SQL Editor**, paste in the whole of [`backend/schema.sql`](backend/schema.sql), and press **Run**.
2. **Connect the site.** In Supabase, copy your **Project URL** and your **publishable key** (or the legacy `anon` key) from Project Settings. Paste them into [`frontend/config.js`](frontend/config.js). That key is meant to be public, so it's fine to commit.
3. **Turn on Pages.** On GitHub, go to repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. Push to `main` and the workflow in `.github/workflows/pages.yml` publishes `frontend/` to `https://<you>.github.io/freefinder/`.

Supabase pauses free projects after a week with no activity; open the dashboard and press Restore if that happens.

### Running locally

```
python -m http.server 8000 -d frontend
```

Then open http://localhost:8000. It still talks to your Supabase project.

## Admin: deleting accounts from the backend

In Supabase → SQL Editor:

```sql
select * from ff.admin_list_accounts();                       -- everyone, with ids
select ff.admin_delete_account('<id from the list>');
select ff.admin_delete_account_by_code('apple.river.stone');
```

People can also delete their own account under **My account → Delete account**.

## Credits
credits NOT to me, I am just someone who had some fun making this. 
