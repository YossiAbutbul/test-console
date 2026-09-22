"""FSC3 constants. Each value is a measured property of the instrument."""

# Plugged in directly over LAN the FSC3 sits at this address and hands the PC
# 172.16.10.2. R&S handhelds (FSC/FSH) listen for SCPI on 5555, not the 5025
# most other R&S instruments use.
DEFAULT_HOST = "172.16.10.1"
DEFAULT_PORT = 5555

# The FSC3 refuses CALC:MARK<n>:STAT ON unless every lower marker is already
# on, so markers are addressed as a count 1..MARKERS rather than a free set.
MARKERS = 6

# Levels the analyzer cannot resolve come back as the 9.91e37 sentinel.
INVALID = 1e30

TRACE_MODES = ("WRIT", "MAXH", "MINH", "AVER", "VIEW")
TRACE_MODE_NAMES = {
    "WRIT": "Clear write",
    "MAXH": "Max hold",
    "MINH": "Min hold",
    "AVER": "Average",
    "VIEW": "View",
}

# Measured: APE/POS/NEG/SAMP/RMS are accepted, MAXP is not a token here (-141),
# and AVER and QPE are rejected with -221 "Requested detector is not allowed".
# POS is the max-peak detector; APE (auto peak) is the default.
DETECTORS = ("APE", "POS", "NEG", "SAMP", "RMS")
DETECTOR_NAMES = {"APE": "Auto peak", "POS": "Max peak", "NEG": "Min peak",
                  "SAMP": "Sample", "RMS": "RMS"}

# The live view re-counts the markers from scratch every this many reads, to
# notice markers switched on or off from the front panel. In between it only
# confirms the highest known marker: every query costs the analyzer sweep time.
MARKER_VERIFY_EVERY = 12
