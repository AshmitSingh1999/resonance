# scripts

One-time setup helpers. None is needed to run the app day to day.

| Script | Purpose |
|---|---|
| `signing-cert.sh` | creates a stable self-signed code-signing identity |
| `autostart.sh` | installs/removes a user LaunchAgent for the daemon |
| `tuya-setup.sh` | fetches the bulb's local key and writes its config |

## signing-cert.sh

Run once, before building the audio helper.

macOS keys TCC permission records to a binary's **signing identity**. An ad-hoc
signature is a hash of the binary, so every rebuild is a new identity and macOS
re-asks for system-audio permission. A self-signed certificate gives a stable,
certificate-based designated requirement that survives rebuilds.

**OpenSSL 3 cannot produce a PKCS#12 that macOS will import** with its defaults —
it uses a MAC the Security framework rejects, and fails with *"MAC verification
failed (wrong password?)"*, which misleadingly blames the password. The script
passes `-macalg sha1 -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES` and a non-empty
password for this reason.

The resulting identity is reported **untrusted**, which is expected and harmless:
it affects Gatekeeper verification, not the stability of the identity.

If `codesign` later hangs, it is waiting on a keychain dialog because the key's
access list does not include it. Click *Always Allow*, or run
`security set-key-partition-list` once.

## tuya-setup.sh

```sh
TUYA_API_KEY=... TUYA_API_SECRET=... TUYA_REGION=in ./tuya-setup.sh keys
./tuya-setup.sh scan
./tuya-setup.sh configure
./tuya-setup.sh test
```

Credentials can also live in `.resonance/tuya.env`, which the script sources
automatically and which is gitignored.

**It does not use `tinytuya wizard`.** The wizard prompts for everything
interactively, which cannot work when stdin is not a terminal; `keys` calls the
Cloud API directly for the same data.

`configure` merges what each step knows — the cloud half has the local keys, the
LAN scan has addresses and protocol versions — and matches them by device id.

**Re-pairing a bulb issues a new device id and local key.** The cloud lookup then
fails with a permissions error that suggests an account or region problem when it
is really a stale id. Check the portal's Devices tab against the scan output.

## A note on shell scripts here

A Unicode character directly after a shell variable — `"$VENV…"` — is read as part
of the variable name, and under `set -u` reports an unbound variable. All ellipses
in these scripts are ASCII for that reason.
