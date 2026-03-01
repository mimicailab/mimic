# Changelog

All notable changes to Mimic are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial public release of Mimic
- CLI: `mimic init`, `mimic seed`, `mimic host`, `mimic test`, `mimic inspect`, `mimic clean`
- Adapter SDK: base classes, schema registration, response formatting, version management
- Database adapters: PostgreSQL, MongoDB, MySQL, Pinecone, Redis
- API mock adapters: 65+ across fintech, communication, calendar, CRM, ticketing, project management
- MCP servers: matching MCP wrapper for every API mock adapter
- Pre-built personas: 3 finance personas (Alex, Morgan, Riley)
- Mock server: Fastify-based host with adapter auto-loading, request routing, CORS
- Documentation: README, contributing guide, adapter guide, MCP guide, licensing, open source charter
- Examples: finance agent, support agent, devops agent

## [0.1.0] - 2026-XX-XX

Initial release. See above.
