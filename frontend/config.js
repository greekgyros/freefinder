// Your Supabase project. Find both in Supabase -> Project Settings -> API Keys.
// The publishable (or legacy "anon") key is meant to be public: on its own it
// can only call the ff_* functions in backend/schema.sql, not read any tables.
const SUPABASE_URL = 'https://eliztpvudizikxtuhaqv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5vv9ac7bUVm6XqvaXhWyKQ_bf9zVCW0';

// The timetable. Slot ids must match ff.clean_free in backend/schema.sql.
const TIMETABLE = {
  weeks: ['A', 'B'],
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  // Lunch sits between P4 and P5; after school comes last.
  slots: [
    { id: '1', label: 'P1' },
    { id: '2', label: 'P2' },
    { id: '3', label: 'P3' },
    { id: '4', label: 'P4' },
    { id: 'L', label: 'Lunch' },
    { id: '5', label: 'P5' },
    { id: '6', label: 'P6' },
    { id: 'AS', label: 'After school' },
  ],
};
