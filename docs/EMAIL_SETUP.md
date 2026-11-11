# Email setup for Askel (about 30 minutes, mostly waiting for DNS)

Two separate jobs:
1. **Sending** account emails (confirm email, password reset) from `noreply@askel.com.au`.
2. **Receiving** mail sent to `hello@askel.com.au` (the address on the website).

## 1. Sending: Resend + Supabase

1. Create a free account at https://resend.com (free plan: about 3,000 emails a month, 100 a day).
2. In Resend, go to **Domains**, then **Add domain**, and enter `askel.com.au`. Pick the region closest to Australia if asked.
3. Resend shows a few DNS records (usually 1 MX, 2 TXT for SPF and DKIM). Add each one in your domain's DNS (GoDaddy: My Products, then DNS for askel.com.au, then Add). Copy the **name** and **value** exactly. Wait until Resend shows the domain as **Verified** (minutes to an hour).
4. In Resend, go to **API Keys**, create one called "Supabase" with **Sending access**, and copy it (shown once).
5. In Supabase, open your project, then **Authentication**, then **Emails** (or Settings), then **SMTP Settings**, and turn on **Custom SMTP**:
   - Sender email: `noreply@askel.com.au`
   - Sender name: `Askel`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the API key from step 4
   Save.
6. Still in Supabase, go to **Authentication**, then **URL Configuration**:
   - **Site URL:** `https://askel.com.au/app/`
   - **Redirect URLs:** add all three:
     `https://askel.com.au/app/`
     `https://askel.com.au/dashboard.html`
     `https://askel.com.au/admin.html`
7. Go to **Authentication**, then **Sign In / Providers**, then **Email**, and turn **Confirm email** ON.
8. (Optional) Under **Authentication**, **Email Templates**, edit the wording of "Confirm signup" and "Reset password" so they sound like Askel (for example subject: "Confirm your Askel account").
9. Test: sign up in the app with a real email. You should receive a confirmation email from Askel. Tap the link, and you land in the app signed in. Then try Forgot password.

## 2. Receiving: hello@askel.com.au

Pick one:
- **Your registrar's email forwarding** (GoDaddy has this for domains: Domain settings, then Forwarding or Email). Forward `hello@askel.com.au` to your own inbox.
- **ImprovMX** (free): sign up at improvmx.com, add `askel.com.au`, add the two MX records it gives you in your DNS, and create `hello` forwarding to your inbox.

Note: adding MX records for receiving can conflict with the MX record Resend asked for (Resend usually uses a subdomain like `send.askel.com.au`, so they normally coexist). If DNS shows a clash, tell me which records you see and I will sort it out.

## Before real users
- Confirm email is ON and the test above passes.
- Fill in the yellow placeholders on https://askel.com.au/privacy.html and /terms.html (your name or business name, ABN, hosting region, governing state).
- Have a lawyer review both pages.
