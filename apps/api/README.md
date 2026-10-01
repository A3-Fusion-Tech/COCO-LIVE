# API application

The API workspace owns synchronous application commands and queries. It will be a modular monolith whose boundaries are documented in [ARCHITECTURE.md](../../ARCHITECTURE.md).

The API must not perform slow source polling or notification fan-out inside HTTP requests. Those operations belong to the worker workspace.

