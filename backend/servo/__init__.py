"""Arduino-controlled servo (RF switch) over serial."""
from .manager import (  # noqa: F401
    connect,
    disconnect,
    discover,
    discover_with_idn,
    goto,
    move_angle,
    read_status,
    save,
)
