-- Manual migration to add preferredNickname column to user_profiles table
-- Run this SQL against your database to add the nickname feature

-- Add the preferredNickname column
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS "preferredNickname" TEXT;

-- Add comment for documentation
COMMENT ON COLUMN user_profiles."preferredNickname" IS 'User-set or bot-learned preferred nickname. Takes priority over server/display name.';
