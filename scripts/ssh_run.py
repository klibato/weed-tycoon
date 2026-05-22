#!/usr/bin/env python3
"""Helper SSH pour la VM. Lit le mot de passe depuis $VM_PASSWORD (jamais en argv).

Usage:
    VM_PASSWORD=... python ssh_run.py exec "uptime"
    VM_PASSWORD=... python ssh_run.py put local.sh /root/remote.sh
"""
import os
import sys
import paramiko

HOST = os.environ.get("VM_HOST", "217.160.192.117")
USER = os.environ.get("VM_USER", "root")
PASSWORD = os.environ.get("VM_PASSWORD")

if not PASSWORD:
    print("ERROR: VM_PASSWORD env var required", file=sys.stderr)
    sys.exit(2)


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30, banner_timeout=30)
    return client


def cmd_exec(command):
    client = connect()
    try:
        stdin, stdout, stderr = client.exec_command(command, get_pty=True, timeout=None)
        # Stream output line by line
        for line in iter(stdout.readline, ""):
            sys.stdout.write(line)
            sys.stdout.flush()
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            sys.stderr.write(err)
        exit_status = stdout.channel.recv_exit_status()
        return exit_status
    finally:
        client.close()


def cmd_put(local_path, remote_path):
    """Try SFTP first; fall back to exec + stdin redirect if sftp-server missing."""
    client = connect()
    try:
        try:
            sftp = client.open_sftp()
            sftp.put(local_path, remote_path)
            sftp.close()
            print(f"OK (sftp): uploaded {local_path} -> {remote_path}")
            return 0
        except Exception as e:
            print(f"SFTP failed ({e}), falling back to exec+stdin", file=sys.stderr)

        # Fallback: read locally, write remotely via cat
        with open(local_path, "rb") as f:
            data = f.read()
        # Use base64 to be transport-safe through pty/shell
        import base64
        b64 = base64.b64encode(data).decode("ascii")
        # Chunk if too large; here-doc is fine up to a few MB
        cmd = f"set -e; echo '{b64}' | base64 -d > {remote_path}; chmod +x {remote_path}; ls -la {remote_path}"
        stdin, stdout, stderr = client.exec_command(cmd, get_pty=False, timeout=60)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        status = stdout.channel.recv_exit_status()
        if status != 0:
            sys.stderr.write(err)
            return status
        print(out.strip())
        print(f"OK (exec): uploaded {local_path} -> {remote_path}")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    op = sys.argv[1]
    if op == "exec":
        if len(sys.argv) != 3:
            print("Usage: ssh_run.py exec \"<command>\"", file=sys.stderr)
            sys.exit(2)
        sys.exit(cmd_exec(sys.argv[2]))
    elif op == "put":
        if len(sys.argv) != 4:
            print("Usage: ssh_run.py put <local> <remote>", file=sys.stderr)
            sys.exit(2)
        sys.exit(cmd_put(sys.argv[2], sys.argv[3]))
    else:
        print(f"Unknown op: {op}", file=sys.stderr)
        sys.exit(2)
