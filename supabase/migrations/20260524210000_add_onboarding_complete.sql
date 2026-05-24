-- Add onboarding_complete flag so the app can show the role-selection dialog
-- on first sign-in (Google OAuth or email). Once the user picks their role the
-- flag is flipped to true and the dialog never appears again.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false;
