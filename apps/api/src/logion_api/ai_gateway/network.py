import asyncio
import ipaddress
import re
import socket
from collections.abc import Awaitable, Callable
from typing import cast

Resolver = Callable[[str, int], Awaitable[list[str]]]


class ProviderDnsUnresolvable(ValueError):
    pass


class ProviderDnsNotPublic(ValueError):
    def __init__(self, resolved_count: int) -> None:
        super().__init__("provider DNS resolution is not exclusively public")
        self.resolved_count = resolved_count


def dns_error_details(hostname: str, resolved_count: int) -> dict[str, str | int | None]:
    # Redact address-like hostnames too (trailing dots or IPs embedded in DNS names).
    safe_hostname = (
        None if ":" in hostname or re.search(r"(?:\d{1,3}\.){3}\d{1,3}", hostname) else hostname
    )
    return {"hostname": safe_hostname, "resolved_count": resolved_count}


async def resolve_host(hostname: str, port: int) -> list[str]:
    records = await asyncio.to_thread(
        socket.getaddrinfo,
        hostname,
        port,
        socket.AF_UNSPEC,
        socket.SOCK_STREAM,
        socket.IPPROTO_TCP,
    )
    return sorted({cast(str, record[4][0]) for record in records})


async def resolve_public_addresses(
    hostname: str,
    port: int,
    resolver: Resolver = resolve_host,
) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        values = await resolver(hostname, port)
        addresses = [ipaddress.ip_address(value) for value in values]
    except (OSError, UnicodeError, ValueError) as exc:
        raise ProviderDnsUnresolvable("provider DNS resolution failed") from exc
    if not addresses:
        raise ProviderDnsUnresolvable("provider DNS resolution returned no addresses")
    if any(not address.is_global for address in addresses):
        raise ProviderDnsNotPublic(len(addresses))
    return addresses
