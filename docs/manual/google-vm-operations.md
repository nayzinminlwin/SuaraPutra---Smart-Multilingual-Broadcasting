# Google VM Operations Manual

This manual describes the repeatable operating procedure for the SuaraPutra
service on the Google Compute Engine VM `suaraputra-server`.

The VM uses:

- Project: `suaraputra`
- Zone: `us-west1-b`
- Application directory: `/opt/suaraputra`
- Service: `suaraputra.service`
- WhatsApp auth directory: `/opt/suaraputra/private/whatsapp-auth`

Run Google Cloud commands from Cloud Shell or a local machine with the Google
Cloud CLI authenticated. Run Linux commands after connecting to the VM.

## 1. Start and connect to the VM

Starting or stopping the VM does not delete files on its persistent disk.

```bash
gcloud compute instances start suaraputra-server \
  --project=suaraputra \
  --zone=us-west1-b
```

Connect through Identity-Aware Proxy (IAP):

```bash
gcloud compute ssh nayzinminlwin22@suaraputra-server \
  --project=suaraputra \
  --zone=us-west1-b \
  --tunnel-through-iap
```

Confirm that the prompt identifies the VM:

```text
nayzinminlwin22@suaraputra-server:~$
```

Check the VM and service:

```bash
hostname
systemctl is-enabled suaraputra
systemctl is-active suaraputra
sudo systemctl status suaraputra --no-pager
```

Expected results are `enabled` and `active`.

## 2. Stop, restart, and power off

### Stop only the application service

Use this for configuration changes, deployment, or a controlled WhatsApp
pairing session:

```bash
sudo systemctl stop suaraputra
sudo systemctl is-active suaraputra
```

The expected result after stopping is `inactive`.

### Restart only the application service

Use this after changing `.env` or installing a new build:

```bash
sudo systemctl restart suaraputra
sudo systemctl status suaraputra --no-pager
sudo journalctl -u suaraputra --since "5 minutes ago" --no-pager
```

### Restart the whole VM

Run this from Cloud Shell or another machine with `gcloud`:

```bash
gcloud compute instances reset suaraputra-server \
  --project=suaraputra \
  --zone=us-west1-b
```

After the VM boots, reconnect and verify that the enabled service started:

```bash
systemctl is-enabled suaraputra
systemctl is-active suaraputra
```

### Stop the VM

Stopping preserves `/opt/suaraputra`, `.env`, `data/`, and
`private/whatsapp-auth/` on the persistent disk:

```bash
gcloud compute instances stop suaraputra-server \
  --project=suaraputra \
  --zone=us-west1-b
```

Only delete the VM or its persistent disk after making a verified backup.

## 3. Initial QR pairing on the VM

Pair the dedicated WhatsApp account on the final VM whenever possible. Do not
run the local and VM Baileys clients at the same time with the same auth
state.

### 3.1 Prepare the environment

Inside the VM:

```bash
cd /opt/suaraputra
sudo systemctl stop suaraputra
sudo grep -E '^(WHATSAPP_ADAPTER_MODE|WHATSAPP_AUTH_DIR|BROADCAST_KILL_SWITCH)=' .env
```

The values must include:

```env
WHATSAPP_ADAPTER_MODE=baileys
WHATSAPP_AUTH_DIR=/opt/suaraputra/private/whatsapp-auth
BROADCAST_KILL_SWITCH=true
```

Do not print the complete `.env` file. It contains secrets.

Ensure the auth directory is protected and owned by the service user:

```bash
sudo install -d -o suaraputra -g suaraputra -m 700 \
  /opt/suaraputra/private/whatsapp-auth
```

### 3.2 Start the interactive pairing process

Run this inside the VM:

```bash
sudo -u suaraputra -H bash -lc \
  'cd /opt/suaraputra && node dist/src/app.js'
```

When the QR code appears:

1. Open WhatsApp on the dedicated phone.
2. Open **Settings → Linked devices**.
3. Select **Link a device**.
4. Scan the QR code in the VM terminal.
5. Wait for the connection and credential update messages.

Stop the interactive process with `Ctrl+C` after pairing completes. Do not
start the systemd service while this interactive process is running.

Check the auth files without displaying their contents:

```bash
sudo find /opt/suaraputra/private/whatsapp-auth \
  -maxdepth 1 -type f -printf '%f\n'
sudo stat -c '%A %U:%G %n' /opt/suaraputra/private/whatsapp-auth
```

Start the service again:

```bash
sudo systemctl start suaraputra
sudo systemctl status suaraputra --no-pager
sudo journalctl -u suaraputra --since "5 minutes ago" --no-pager
```

Keep `BROADCAST_KILL_SWITCH=true` until source and destination group
membership, JIDs, and sending permissions have been verified.

## 4. Back up the WhatsApp auth directory securely

The auth directory contains linked-device credentials. Treat a backup like a
password. Never commit it, place it in the repository, paste it into chat, or
upload it to a public service.

The following procedure copies the auth state from the VM to a local Windows
machine. Replace `C:\Users\YOUR_WINDOWS_USER` with a local path outside the
repository.

### 4.1 Create a temporary protected archive on the VM

Inside the VM:

```bash
sudo systemctl stop suaraputra
sudo tar -C /opt/suaraputra/private \
  -czf /tmp/suaraputra-whatsapp-auth.tar.gz \
  whatsapp-auth
sudo chown nayzinminlwin22:nayzinminlwin22 \
  /tmp/suaraputra-whatsapp-auth.tar.gz
chmod 600 /tmp/suaraputra-whatsapp-auth.tar.gz
```

### 4.2 Download the archive to Windows

Run this from local PowerShell, not from inside the VM:

```powershell
gcloud compute scp `
  nayzinminlwin22@suaraputra-server:/tmp/suaraputra-whatsapp-auth.tar.gz `
  "$env:USERPROFILE\Downloads\suaraputra-whatsapp-auth.tar.gz" `
  --project=suaraputra `
  --zone=us-west1-b `
  --tunnel-through-iap
```

After confirming the download completed, remove the temporary VM archive from
inside the VM:

```bash
rm -f /tmp/suaraputra-whatsapp-auth.tar.gz
sudo systemctl start suaraputra
```

Protect the local backup and keep it outside the repository. On Windows,
restrict access to the file through its folder permissions and delete it when
it is no longer needed.

Do not run a local Baileys process using this auth state while the VM service
is running. Concurrent clients can invalidate the session or cause duplicate
processing.

## 5. Resolve group invite links to JIDs

After pairing, use the read-only discovery script to resolve the source and
four destination group invite links. It calls Baileys
`groupGetInviteInfo()`; it does not join groups. Stop the service first so
there is only one Baileys socket using the auth state:

```bash
sudo systemctl stop suaraputra
cd /opt/suaraputra
sudo -u suaraputra -H bash -lc \
  'cd /opt/suaraputra && npm run discover:groups'
```

Enter one HTTPS invite link for each prompt:

```text
https://chat.whatsapp.com/INVITE_CODE
```

The script displays the resolved group name and JID, asks for confirmation,
then updates only these variables in `/opt/suaraputra/.env`:

```text
WHATSAPP_SOURCE_GROUP_JID
WHATSAPP_MALAY_GROUP_JID
WHATSAPP_ENGLISH_GROUP_JID
WHATSAPP_MANDARIN_GROUP_JID
WHATSAPP_TAMIL_GROUP_JID
```

It rejects malformed links and duplicate group JIDs. Verify that each
resolved group is the intended Community group and that the paired account
has the required membership and send permission before changing
`BROADCAST_KILL_SWITCH` to `false`.

The script uses an atomic replacement when the application directory is
writable by the service user. If the VM keeps the application directory owned
by the deployment user, it falls back to updating the existing mode-`600`
`.env` file in place and prints a warning.

Start the service after the mappings are saved:

```bash
sudo systemctl start suaraputra
sudo systemctl status suaraputra --no-pager
```

## 6. Restore auth state to the VM

Use this only when the VM auth directory is unavailable and the local backup
is known to be current. Stop all Baileys clients first.

From local PowerShell:

```powershell
gcloud compute scp `
  "$env:USERPROFILE\Downloads\suaraputra-whatsapp-auth.tar.gz" `
  nayzinminlwin22@suaraputra-server:/tmp/suaraputra-whatsapp-auth.tar.gz `
  --project=suaraputra `
  --zone=us-west1-b `
  --tunnel-through-iap
```

Inside the VM:

```bash
sudo systemctl stop suaraputra
sudo rm -rf /opt/suaraputra/private/whatsapp-auth
sudo tar -C /opt/suaraputra/private \
  -xzf /tmp/suaraputra-whatsapp-auth.tar.gz
sudo chown -R suaraputra:suaraputra \
  /opt/suaraputra/private/whatsapp-auth
sudo chmod 700 /opt/suaraputra/private/whatsapp-auth
rm -f /tmp/suaraputra-whatsapp-auth.tar.gz
sudo systemctl start suaraputra
sudo journalctl -u suaraputra --since "5 minutes ago" --no-pager
```

If WhatsApp reports logout or invalid credentials, stop the service and pair
again with a new QR code. Do not repeatedly retry a logged-out session.

## 7. Update application code from Git

Application code is updated through Git. `.env`, `data/`, and
`private/whatsapp-auth/` are VM-local and must not be committed.

From local PowerShell, push tested changes:

```powershell
Set-Location 'D:\alexyy\projects\SuaraPutra_Smart_Multilingual_Broadcasting'
git status
git push origin master
```

Inside the VM:

```bash
cd /opt/suaraputra
sudo systemctl stop suaraputra
git pull --ff-only origin master
npm ci
npm run typecheck
npm run build
sudo systemctl start suaraputra
sudo systemctl status suaraputra --no-pager
```

If validation fails, do not start the new build. Inspect the error, restore the
last known-good code, and investigate before continuing.

## 8. Run the synthetic simulation

The simulation uses the mock adapter and does not send WhatsApp messages:

```bash
sudo -u suaraputra -H bash -lc \
  'cd /opt/suaraputra && AI_PROVIDER=mock WHATSAPP_ADAPTER_MODE=mock npm run simulate:live'
```

Inspect generated files:

```bash
find /opt/suaraputra/simulation/outbox -maxdepth 2 -type f -print
```

Run the simulation before enabling live publishing after a deployment.

## 9. Enable or disable publishing

Use the kill switch during pairing, maintenance, troubleshooting, and group
permission verification.

To disable new delivery claims:

```bash
sudo sed -i 's/^BROADCAST_KILL_SWITCH=.*/BROADCAST_KILL_SWITCH=true/' \
  /opt/suaraputra/.env
sudo systemctl restart suaraputra
```

To enable publishing only after verification:

```bash
sudo sed -i 's/^BROADCAST_KILL_SWITCH=.*/BROADCAST_KILL_SWITCH=false/' \
  /opt/suaraputra/.env
sudo systemctl restart suaraputra
```

Confirm service logs after either change:

```bash
sudo journalctl -u suaraputra --since "5 minutes ago" --no-pager
```

## 10. Basic recovery checks

```bash
systemctl is-enabled suaraputra
systemctl is-active suaraputra
sudo journalctl -u suaraputra -n 100 --no-pager
df -h /opt/suaraputra
free -h
```

If the service is not healthy:

1. Set `BROADCAST_KILL_SWITCH=true`.
2. Stop the service if the WhatsApp state is uncertain.
3. Inspect recent logs without exposing auth or API-key values.
4. Do not blindly resend jobs in `uncertain` state.
5. Re-pair only after a logged-out or invalid-credentials condition is
   confirmed.

For the authoritative operational policy, see the
[operations runbook](../operations-runbook.md).
