-- Add image_url column to groups table for group avatars/photos.
alter table groups add column if not exists image_url text;

comment on column groups.image_url is 'Base64 data-URI or URL for the group avatar image.';
