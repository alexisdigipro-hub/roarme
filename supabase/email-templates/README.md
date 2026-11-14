# The emails Supabase Auth sends for RoarMe (Alex, 14 Nov 2026, look A: light, like the sign-in screen)

Pasted by hand in Supabase > Authentication > Emails > Templates. They go out from RoarMe <noreply@themadlions.com>
through Resend's SMTP (Authentication > Emails > SMTP Settings: smtp.resend.com, port 465, user `resend`, the password
a Resend API key that Alex keeps; never in the repo).

| Template in Supabase | Subject | File |
|---|---|---|
| Confirm signup | Confirm your RoarMe email | confirm-signup.html |
| Reset password | Set a new RoarMe password | reset-password.html |
