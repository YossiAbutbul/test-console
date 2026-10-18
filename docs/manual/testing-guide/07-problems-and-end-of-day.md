# 7. When something goes wrong

| What you see | What to do |
|---|---|
| **Connect is greyed out** | The unit isn't in the current scan. Press **Scan**, and check the **Device type**. |
| **The test page is faded and won't respond** | The DUT isn't connected. Connect it again. |
| **An instrument won't connect** | Read the message on its row in the Instruments panel (1.2). Check power and cables. |
| **"No signal at the power sensor"** | Check the RF cables. Check that the DUT is actually transmitting. Try a longer **Settle**. |
| **A low-power point reads too high** | Settle is too short. Use at least 400 ms. |
| **Measured power is off by the same amount everywhere** | The path loss is wrong or missing for that frequency (it shows **uncalibrated**). Measure it (6.1). |
| **The DUT stops answering during a run** | Disconnect it, power-cycle it, connect again, and re-run. |
| **LTE: "modem on rejected"** | Turn the **Modem** key off, then on. |
| **LTE: the channel didn't change** | Press **Stop**, then **Send** again. |
| **Load Pull: Run is greyed out** | Read the **Before running** notice. Usually the path isn't confirmed, or Zero/End aren't captured. |
| **Load Pull: the trombone won't jog further** | It is at Zero or End. That is the travel limit working. |
| **Mode Sweep results have gone** | They are lost when the console restarts. Export after every run. |
| **A tag in the top bar won't go away** | Click it to open the page that controls it, and turn that output off there. |

If a problem keeps happening, download the **Log** (5.4) and pass it on with
a description of what you were doing.

## End-of-day checklist

1. Press **Stop** on any page that is transmitting.
2. Turn the LTE **Modem** key off.
3. On the Signal Generator page, press **RF Off**.
4. Turn the DUT supply off (Settings or the DC Analyzer page).
5. Check the top bar: **no tags** should be showing.
6. Export anything you haven't saved.
7. Disconnect the DUT.

## Words used in this guide

| Word | Meaning |
|---|---|
| **DUT** | Device under test: the meter being tested |
| **PA** | Power amplifier |
| **CW** | A plain, unmodulated carrier |
| **Path loss** | The loss between the DUT and the sensor, added to every reading |
| **Settle** | How long the DUT transmits before the reading |
| **Tolerance** | The ± dB window for a PASS |
| **PA Duty Cycle, HP Max** | Two PA settings that Mode Sweep tries in every combination |
| **EARFCN** | An LTE channel number |
| **MCS / RB** | LTE modulation level / resource blocks |
| **Trombone** | A motorised line whose length changes the load |
| **Smith chart** | A chart of load impedance; the centre is 50 Ω |
| **VSWR** | How far the load is from 50 Ω (1.0 is perfect) |
