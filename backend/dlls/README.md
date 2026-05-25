# Instrument DLLs

Repo-bundled native DLLs for instrument wrappers. Layout:

```
dlls/
  motor/          PerformaxCom.dll, SiUSBXp.dll       (Arcus DMX-J-SA motor)
  power_sensor/   mcl_pm_NET45.dll                    (Mini-Circuits PM)
```

`backend/dll_setup.py` runs at backend startup and:
- calls `os.add_dll_directory()` for every subdirectory here, so Windows can
  resolve dependent DLLs (e.g. `PerformaxCom.dll` needs `SiUSBXp.dll`);
- sets wrapper-specific env vars (currently `MCL_PM_DLL_DIR` → `power_sensor/`).

To add a new device:
1. Drop its DLL(s) under `dlls/<device>/`.
2. If the wrapper expects an env var to find the DLL, add the mapping to
   `_ENV_OVERRIDES` in `backend/dll_setup.py`.
