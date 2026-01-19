-- Add front_photo_path column for dual camera mode
ALTER TABLE posts ADD COLUMN IF NOT EXISTS front_photo_path TEXT;

-- Add comment explaining the columns
COMMENT ON COLUMN posts.photo_path IS 'Main photo (back camera for dual mode, the only photo for single modes)';
COMMENT ON COLUMN posts.front_photo_path IS 'Front camera photo for dual mode (NULL for single camera modes)';
