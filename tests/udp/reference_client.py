#!/usr/bin/env python3
"""Client de RÉFÉRENCE du protocole UDP LABOSURF PRO (voir LABOSURF_PRO/PROTOCOL.md), en Python standard, sans dépendance.

Sert à : (1) prouver qu'un serveur UDP LABOSURF transporte réellement du trafic (DNS, ICMP) de bout en bout, y compris derrière
un NAT ; (2) fournir la référence croisée de l'implémentation Kotlin (mêmes constantes, mêmes vecteurs de test).

    python tests/udp/reference_client.py --host IP --port 5667 --user NOM --password-file FICHIER [--legacy-clientid]

Le mot de passe n'est jamais passé en argument ni affiché. Sortie : une ligne PASS/FAIL par vérification.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import socket
import struct
import sys
import time

TUNNEL_VERSION = 1
HEADER = 12


def auth_response(nonce_hex: str, password: str) -> str:
    """HMAC-SHA256(clé = mot de passe, message = octets bruts du nonce), en hexadécimal."""
    return hmac.new(password.encode(), bytes.fromhex(nonce_hex), hashlib.sha256).hexdigest()


def client_id_from_addr(addr: str) -> int:
    """ClientID = SHA-256("ip:port")[0:8] en big-endian (adresse SOURCE telle que vue par le serveur)."""
    return int.from_bytes(hashlib.sha256(addr.encode()).digest()[:8], "big")


def encode_tunnel(client_id: int, ip_packet: bytes) -> bytes:
    return bytes([TUNNEL_VERSION, 0, 0, 0]) + client_id.to_bytes(8, "big") + ip_packet


def decode_tunnel(data: bytes):
    if len(data) < HEADER or data[0] != TUNNEL_VERSION:
        return None
    return int.from_bytes(data[4:12], "big"), data[12:]


def checksum(b: bytes) -> int:
    if len(b) % 2:
        b += b"\0"
    s = sum(struct.unpack("!%dH" % (len(b) // 2), b))
    while s >> 16:
        s = (s & 0xFFFF) + (s >> 16)
    return ~s & 0xFFFF


def ipv4(src: str, dst: str, proto: int, payload: bytes, ident: int = 0x4242) -> bytes:
    hdr = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(payload), ident, 0, 64, proto, 0, socket.inet_aton(src), socket.inet_aton(dst))
    hdr = hdr[:10] + struct.pack("!H", checksum(hdr)) + hdr[12:]
    return hdr + payload


def dns_query(name: str, qid: int = 0x1D1D) -> bytes:
    q = b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\0"
    return struct.pack("!HHHHHH", qid, 0x0100, 1, 0, 0, 0) + q + struct.pack("!HH", 1, 1)


def udp_datagram(src: str, dst: str, sport: int, dport: int, payload: bytes) -> bytes:
    udp = struct.pack("!HHHH", sport, dport, 8 + len(payload), 0) + payload   # somme UDP à 0 : autorisée en IPv4
    return ipv4(src, dst, 17, udp)


def icmp_echo(src: str, dst: str, ident: int = 0x1234, seq: int = 1) -> bytes:
    body = struct.pack("!BBHHH", 8, 0, 0, ident, seq) + b"labosurf-udp-check"
    body = body[:2] + struct.pack("!H", checksum(body)) + body[4:]
    return ipv4(src, dst, 1, body)


class Result:
    def __init__(self):
        self.rows = []

    def check(self, name: str, ok: bool, detail: str = ""):
        self.rows.append(ok)
        print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


def handshake(sock: socket.socket, password: str, timeout: float = 5.0):
    """Retourne (réponse AUTH, ip_tunnel|None, client_id_serveur|None). Accepte l'ordre AUTH_OK / CLIENT_ID dans les deux sens."""
    sock.settimeout(timeout)
    sock.send(b"HELLO")
    msg = sock.recv(4096).decode(errors="replace")
    if not msg.startswith("CHALLENGE "):
        return msg, None, None
    sock.send(b"AUTH " + auth_response(msg.split(" ", 1)[1].strip(), password).encode())
    reply, ip, cid = None, None, None
    deadline = time.time() + timeout
    while time.time() < deadline and (reply is None or (reply.startswith("AUTH_OK") and cid is None)):
        sock.settimeout(max(0.2, min(1.0, deadline - time.time())) if reply else timeout)
        try:
            m = sock.recv(4096).decode(errors="replace")
        except socket.timeout:
            break
        if m.startswith("CLIENT_ID "):
            cid = int(m.split(" ", 1)[1].strip(), 16)
        else:
            reply = m
            if m.startswith("AUTH_OK") and len(m.split()) >= 2:
                ip = m.split()[1]
            elif not m.startswith("AUTH_OK"):
                break
    return reply, ip, cid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", type=int, default=5667)
    ap.add_argument("--user", default="")
    ap.add_argument("--password-file", required=True, help="fichier JSON {\"password\": ...} ou texte brut")
    ap.add_argument("--legacy-clientid", action="store_true", help="ancien comportement : ClientID calculé depuis l'adresse LOCALE (échoue derrière un NAT)")
    ap.add_argument("--only-handshake", action="store_true")
    ap.add_argument("--hold", type=int, default=0, help="secondes de maintien (keepalive) avant de terminer")
    a = ap.parse_args()

    raw = open(a.password_file, encoding="utf-8").read().strip()
    try:
        password = json.loads(raw)["password"]
    except Exception:
        password = raw
    r = Result()

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect((a.host, a.port))
    local = "%s:%d" % s.getsockname()

    # 1. mauvais mot de passe -> refus
    bad = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    bad.connect((a.host, a.port))
    reply, _, _ = handshake(bad, "mot-de-passe-incorrect-" + password[::-1])
    r.check("mauvais mot de passe refusé (AUTH_FAIL)", reply == "AUTH_FAIL", repr(reply))
    bad.close()

    # 2. handshake réel
    reply, ip, cid = handshake(s, password)
    r.check("handshake : AUTH_OK + IP tunnel", bool(reply) and reply.startswith("AUTH_OK") and ip is not None, f"réponse={reply!r}")
    if not (reply and reply.startswith("AUTH_OK") and ip):
        return 1
    r.check("ClientID annoncé par le serveur (CLIENT_ID)", cid is not None, "" if cid is None else f"{cid:016x}")
    local_id = client_id_from_addr(local)
    use_id = local_id if (a.legacy_clientid or cid is None) else cid
    print(f"INFO adresse locale={local} ; ClientID local={local_id:016x} ; ClientID serveur={'-' if cid is None else format(cid, '016x')}"
          f" ; identique={'oui' if cid == local_id else 'NON (NAT détecté)'}", flush=True)
    if a.only_handshake:
        return 0 if all(r.rows) else 1

    # 3. keepalive
    s.send(b"PING")
    s.settimeout(3)
    try:
        r.check("keepalive PING -> PONG", s.recv(64) == b"PONG")
    except socket.timeout:
        r.check("keepalive PING -> PONG", False, "aucune réponse")

    def exchange(pkt: bytes, want_proto: int, wait: float = 4.0):
        s.send(encode_tunnel(use_id, pkt))
        end = time.time() + wait
        while time.time() < end:
            s.settimeout(max(0.2, end - time.time()))
            try:
                d = s.recv(65535)
            except socket.timeout:
                return None
            dec = decode_tunnel(d)
            if not dec:
                continue
            cid_in, payload = dec
            if cid_in != use_id or len(payload) < 20 or payload[9] != want_proto:
                continue
            return payload
        return None

    # 4. trafic réel : requête DNS vers 1.1.1.1 à travers le tunnel puis Internet
    reply_pkt = exchange(udp_datagram(ip, "1.1.1.1", 40123, 53, dns_query("example.com")), 17)
    ok = False
    detail = "aucune réponse (paquet rejeté ou perdu)"
    if reply_pkt:
        ihl = (reply_pkt[0] & 0x0F) * 4
        dns = reply_pkt[ihl + 8:]
        if len(dns) >= 12:
            qid, flags, qd, an = struct.unpack("!HHHH", dns[:8])
            ok = qid == 0x1D1D and (flags & 0x000F) == 0 and an >= 1
            src = socket.inet_ntoa(reply_pkt[12:16])
            detail = f"réponse DNS de {src} : {an} enregistrement(s)"
    r.check("trafic réel : requête DNS via le tunnel (UDP)", ok, detail)

    # 5. ICMP (ping) via le tunnel
    t0 = time.time()
    icmp = exchange(icmp_echo(ip, "1.1.1.1"), 1)
    r.check("trafic réel : ping ICMP via le tunnel", bool(icmp) and icmp[(icmp[0] & 0x0F) * 4] == 0,
            f"{(time.time() - t0) * 1000:.0f} ms" if icmp else "aucune réponse")

    # 6. maintien
    if a.hold:
        end = time.time() + a.hold
        while time.time() < end:
            time.sleep(min(20, end - time.time()))
            s.send(b"PING")
            try:
                s.settimeout(3)
                s.recv(64)
            except socket.timeout:
                pass
        r.check("session maintenue", True)
    s.close()
    print("RESULT " + ("OK" if all(r.rows) else "ECHEC"))
    return 0 if all(r.rows) else 1


if __name__ == "__main__":
    sys.exit(main())
