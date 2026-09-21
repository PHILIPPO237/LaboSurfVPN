#!/usr/bin/env python3
"""FAUX serveur UDP LABOSURF, POUR LES TESTS DE LA CHAÎNE ANDROID UNIQUEMENT (émulateur en CI). Jamais un vrai VPN :
il ne transporte RIEN vers Internet. Il implémente le protocole de PROTOCOL.md (HELLO/CHALLENGE/AUTH, CLIENT_ID annoncé, PING/PONG,
paquets tunnel) et répond localement : DNS (réponse minimale) et ICMP echo. Sert à valider le côté Android (VpnService, TUN,
handshake, vérification du chemin, statistiques) sans dépendre d'un VPS.

    python tests/udp/mock_server.py --port 5667 --password MOT_DE_PASSE --log mock.log
"""
from __future__ import annotations

import argparse
import os
import socket
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from reference_client import auth_response, client_id_from_addr, decode_tunnel, encode_tunnel, ipv4  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5667)
    ap.add_argument("--password", required=True)
    ap.add_argument("--log", default="")
    a = ap.parse_args()
    log = open(a.log, "a", buffering=1) if a.log else sys.stdout

    def say(msg: str):
        log.write(f"{time.strftime('%H:%M:%S')} {msg}\n")

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", a.port))
    say(f"mock UDP LABOSURF en écoute sur {a.port}")
    nonces: dict = {}
    sessions: dict = {}   # addr -> (client_id, tunnel_ip)
    next_ip = 2
    counts = {"auth_ok": 0, "auth_fail": 0, "dns": 0, "icmp": 0, "rejected_clientid": 0, "other": 0}
    while True:
        data, addr = s.recvfrom(65535)
        key = f"{addr[0]}:{addr[1]}"
        if data == b"HELLO":
            nonce = os.urandom(32)
            nonces[addr] = nonce
            s.sendto(b"CHALLENGE " + nonce.hex().encode(), addr)
        elif data.startswith(b"AUTH "):
            nonce = nonces.pop(addr, None)
            ok = nonce is not None and data[5:].decode(errors="replace") == auth_response(nonce.hex(), a.password)
            if not ok:
                counts["auth_fail"] += 1
                say(f"AUTH_FAIL {key} {counts}")
                s.sendto(b"AUTH_FAIL", addr)
                continue
            ip = f"10.77.0.{next_ip}"
            next_ip = 2 + (next_ip - 1) % 200
            cid = client_id_from_addr(key)           # adresse OBSERVÉE (après NAT de l'émulateur)
            sessions[addr] = (cid, ip)
            counts["auth_ok"] += 1
            s.sendto(f"AUTH_OK {ip}".encode(), addr)
            s.sendto(f"CLIENT_ID {cid:016x}".encode(), addr)
            say(f"AUTH_OK {key} ip={ip} {counts}")
        elif data == b"PING":
            s.sendto(b"PONG", addr)
        elif data and data[0] == 1 and addr in sessions:
            dec = decode_tunnel(data)
            cid, ip = sessions[addr]
            if not dec or dec[0] != cid:
                counts["rejected_clientid"] += 1
                say(f"ClientID incorrect {key} {counts}")
                continue
            pkt = dec[1]
            if len(pkt) < 28 or pkt[0] >> 4 != 4:
                counts["other"] += 1
                continue
            ihl = (pkt[0] & 0x0F) * 4
            src, dst, proto = pkt[12:16], pkt[16:20], pkt[9]
            if proto == 17 and struct.unpack("!H", pkt[ihl + 2:ihl + 4])[0] == 53:      # DNS -> réponse minimale (1 enregistrement)
                sport = struct.unpack("!H", pkt[ihl:ihl + 2])[0]
                dns = bytearray(pkt[ihl + 8:])
                dns[2], dns[3], dns[7] = 0x81, 0x80, 1
                udp = struct.pack("!HHHH", 53, sport, 8 + len(dns), 0) + bytes(dns)
                reply = ipv4(socket.inet_ntoa(dst), socket.inet_ntoa(src), 17, udp)
                s.sendto(encode_tunnel(cid, reply), addr)
                counts["dns"] += 1
                say(f"DNS répondu {counts}")
            elif proto == 1 and pkt[ihl] == 8:                                          # ICMP echo request -> echo reply
                icmp = bytearray(pkt[ihl:])
                icmp[0], icmp[2], icmp[3] = 0, 0, 0
                from reference_client import checksum
                icmp[2:4] = struct.pack("!H", checksum(bytes(icmp)))
                reply = ipv4(socket.inet_ntoa(dst), socket.inet_ntoa(src), 1, bytes(icmp))
                s.sendto(encode_tunnel(cid, reply), addr)
                counts["icmp"] += 1
                say(f"ICMP echo répondu {counts}")
            else:
                counts["other"] += 1


if __name__ == "__main__":
    sys.exit(main())
