import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from typing import cast

Resolver = Callable[[str, int], Awaitable[list[str]]]


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
        raise ValueError("provider DNS resolution failed") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("provider DNS resolution is not exclusively public")
    return addresses
