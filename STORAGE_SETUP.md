# Storage Setup Guide

You need to set up the storage bucket and policies. Here's the step-by-step process:

## Step 1: Check if Storage Bucket Exists

Run this SQL in Supabase SQL Editor:

```sql
SELECT * FROM storage.buckets WHERE id = 'posts';
```

**If you get 0 rows:** The bucket doesn't exist - proceed to Step 2.
**If you get 1 row:** The bucket exists - skip to Step 3.

---

## Step 2: Create Storage Bucket

### Option A: Using Supabase Dashboard (Recommended)

1. Go to **Storage** in the left sidebar
2. Click **New bucket**
3. Bucket name: `posts`
4. **Public bucket:** Toggle OFF (keep it private)
5. Click **Create bucket**

### Option B: Using SQL (if dashboard doesn't work)

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('posts', 'posts', false);
```

---

## Step 3: Add Storage Policies

You need to add these 3 policies. Go to **Storage** → Click on the `posts` bucket → **Policies** tab.

### Policy 1: Users can upload to their own folder

Click **New policy** → **For full customization** (or **Custom policy**)

- **Policy name:** `Users can upload own photos`
- **Allowed operation:** INSERT
- **Policy definition:**

```sql
((bucket_id = 'posts'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))
```

- Click **Review** → **Save policy**

---

### Policy 2: Authenticated users can view photos

Click **New policy** → **For full customization**

- **Policy name:** `Authenticated users can view photos`
- **Allowed operation:** SELECT
- **Policy definition:**

```sql
(bucket_id = 'posts'::text)
```

- Click **Review** → **Save policy**

---

### Policy 3: Users can delete their own photos

Click **New policy** → **For full customization**

- **Policy name:** `Users can delete own photos`
- **Allowed operation:** DELETE
- **Policy definition:**

```sql
((bucket_id = 'posts'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))
```

- Click **Review** → **Save policy**

---

## Step 4: Verify Setup

Run this SQL to check all 3 policies exist:

```sql
SELECT name, operation FROM storage.objects_policies WHERE bucket_id = 'posts';
```

You should see 3 rows with operations: INSERT, SELECT, DELETE.

---

## Common Issues

### "storage.policies does not exist"

This error appears when checking policies before creating the bucket. This is normal - the policies table is created automatically when you create your first storage bucket.

**Solution:** Create the storage bucket first (Step 2), then the policies table will exist and you can add policies (Step 3).

---

## Next Steps

Once storage is set up:

1. Run the Potsdam events SQL (from `005_add_potsdam_events.sql`)
2. Test on iPhone
3. Try creating a post at one of the local events
