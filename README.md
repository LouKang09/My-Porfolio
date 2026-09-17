# My Portfolio — Resume CMS

Facebook-inspired resume/portfolio website with a private admin CMS.

## Features

- Public portfolio with responsive Facebook-style layout
- Search across projects, experience, skills, education, certifications, and timeline
- Admin login and editable profile content
- Experience, projects, skills, timeline, education, certifications, and gallery management
- Profile, cover, project, gallery, and resume uploads
- Live project and source-code links
- Contact form with private admin message inbox
- Gmail/default-mail reply composer
- Railway-ready persistent storage support

## Local development

Requires Node.js 20+.

```bash
npm start
```

Open:

- Public site: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin.html`

If `ADMIN_PASSWORD` is not set and no local `data/admin-auth.json` exists, the server creates a starter admin account. Change it immediately from the Account section.

## Security

Do **not** commit credentials, contact messages, or uploaded files. The included `.gitignore` excludes:

- `.env*` secrets
- `data/admin-auth.json`
- `data/messages.json`
- content backups/temp files
- uploaded images/resumes
- local backup folders and logs

`data/content.json` is intentionally committed because it is the public seed content used for a fresh deployment. Do not put secrets in it.

## Railway deployment

Recommended production variables:

```text
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-random-password>
STORAGE_DIR=/data
```

Attach a persistent Railway volume mounted at `/data`. The server stores runtime content, private messages, credentials, backups, uploaded images, and uploaded resumes there.

The service exposes a health endpoint at `/health`.
