# Multi-Tenant Isolation

**Version:** 1.0  
**Project:** CodiDev  
**Repository:** `github.com/Elfried002/codidev`

---

Tenant-owned records require tenant/organization scoping and RLS.

Tenant A must not read or modify Tenant B data, projects, memory, skills or connector state.

The frontend is never the security boundary.

## Implementation note

This document is part of the CodiDev documentation corpus. It defines behavior and boundaries for the corresponding subsystem and must be read together with the neighboring documents.
