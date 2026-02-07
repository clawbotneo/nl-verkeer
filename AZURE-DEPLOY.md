# Azure deploy (minimal refactor)

This project runs as a normal Next.js server (includes `/api/events`).

Recommended: **Azure App Service (Linux) → Container**.

## 1) Create Azure Web App (Container)

Azure Portal → Create resource → **Web App**

- Publish: **Docker Container**
- OS: **Linux**
- Plan: small is fine (start with B1)

## 2) Get publish profile

Azure Portal → your Web App → **Get publish profile** → download XML.

## 3) Configure GitHub Actions secrets

GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

- `AZURE_WEBAPP_NAME` = your web app name
- `AZURE_WEBAPP_PUBLISH_PROFILE` = full XML content

## 4) Container image (GHCR)

Workflow builds and pushes:

- `ghcr.io/clawbotneo/nl-verkeer:<sha>`
- `ghcr.io/clawbotneo/nl-verkeer:latest`

If Azure can’t pull the image, make the package **Public** in GitHub Packages
(or set GHCR credentials in the Web App configuration).

## 5) Validate

After deploy:

- `https://<app>.azurewebsites.net/`
- `https://<app>.azurewebsites.net/healthz`
- `https://<app>.azurewebsites.net/api/events?type=A&road=8&sort=delay`
