# Transformlit Database Design (MVP)

Date: 2026-05-27

## Overview

This document defines the relational schema for Transformlit. It is multi-tenant, uses UUID primary keys, and includes soft deletes plus audit fields on key tables.

## Conventions

- Database: PostgreSQL
- Primary keys: UUID (default `gen_random_uuid()`)
- Timestamps: `created_at`, `updated_at` (UTC)
- Soft delete: `deleted_at`, `deleted_by` (nullable)
- Audit: `created_by`, `updated_by` (nullable on system-created rows)
- Tenant isolation: every user-generated table includes `tenant_id`

## Enums (suggested)

- `user_status`: active, suspended, invited
- `user_role`: tenant_admin, member
- `group_visibility`: public, private
- `group_member_role`: owner, admin, member
- `group_member_status`: active, pending, banned
- `friendship_status`: pending, accepted, rejected, blocked
- `conversation_type`: direct, group
- `announcement_status`: draft, published, archived
- `document_access_type`: read, download

## Tables

### tenants

- id uuid pk
- name text not null
- slug text not null unique
- status text not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Indexes

- unique (slug)

### users

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- email text not null
- email_normalized text not null
- password_hash text not null
- status user_status not null
- role user_role not null
- last_login_at timestamptz null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Constraints

- unique (tenant_id, email_normalized)

Indexes

- (tenant_id, email_normalized)
- (tenant_id, status)

### profiles

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- user_id uuid fk -> users(id)
- display_name text not null
- avatar_url text null
- bio text null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Constraints

- unique (user_id)

Indexes

- (tenant_id)

### friendships

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- requester_id uuid fk -> users(id)
- addressee_id uuid fk -> users(id)
- status friendship_status not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Constraints

- unique (tenant_id, requester_id, addressee_id)
- check (requester_id <> addressee_id)

Indexes

- (tenant_id, requester_id)
- (tenant_id, addressee_id)
- (tenant_id, status)

### groups

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- name text not null
- description text null
- visibility group_visibility not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Indexes

- (tenant_id, name)
- (tenant_id, visibility)

### group_members

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- group_id uuid fk -> groups(id)
- user_id uuid fk -> users(id)
- role group_member_role not null
- status group_member_status not null
- joined_at timestamptz not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Constraints

- unique (group_id, user_id)

Indexes

- (tenant_id, user_id)
- (tenant_id, group_id)
- (tenant_id, status)

### conversations

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- type conversation_type not null
- group_id uuid null fk -> groups(id)
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Indexes

- (tenant_id, type)
- (tenant_id, group_id)

### conversation_members

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- conversation_id uuid fk -> conversations(id)
- user_id uuid fk -> users(id)
- last_read_message_id uuid null fk -> messages(id)
- last_read_at timestamptz null
- joined_at timestamptz not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Constraints

- unique (conversation_id, user_id)

Indexes

- (tenant_id, user_id)
- (tenant_id, conversation_id)

### messages

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- conversation_id uuid fk -> conversations(id)
- sender_id uuid fk -> users(id)
- body text not null
- created_at timestamptz not null
- updated_at timestamptz not null
- edited_at timestamptz null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Indexes

- (tenant_id, conversation_id, created_at desc)
- (tenant_id, sender_id)

### documents

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- title text not null
- description text null
- blob_path text not null
- mime_type text not null
- file_size bigint not null
- access_level text not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Indexes

- (tenant_id, title)

### document_access

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- document_id uuid fk -> documents(id)
- user_id uuid null fk -> users(id)
- group_id uuid null fk -> groups(id)
- access_type document_access_type not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Constraints

- check ((user_id is not null) or (group_id is not null))
- unique (document_id, user_id)
- unique (document_id, group_id)

Indexes

- (tenant_id, document_id)
- (tenant_id, user_id)
- (tenant_id, group_id)

### announcements

- id uuid pk
- tenant_id uuid fk -> tenants(id)
- title text not null
- body text not null
- status announcement_status not null
- publish_at timestamptz null
- expires_at timestamptz null
- published_at timestamptz null
- published_by uuid null fk -> users(id)
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
- created_by uuid null
- updated_by uuid null
- deleted_by uuid null

Indexes

- (tenant_id, status, publish_at desc)
- (tenant_id, expires_at)

## Relationship Notes

- A tenant owns all data via `tenant_id`.
- Users belong to one tenant and can have one profile.
- Groups and group_members enforce membership and roles.
- Conversations are either direct or group-based; participants are in `conversation_members`.
- Announcements are tenant-wide and published only by tenant admins.
- Documents are protected by `document_access` (user or group).

## Soft Delete Behavior

- Soft deletes mark `deleted_at` and `deleted_by` instead of removing rows.
- Queries in the API must filter `deleted_at is null` by default.

## Indexing Notes

- Chat and announcements are read-heavy; composite indexes are added for feed and message queries.
- Tenant-scoped indexes keep multi-tenant queries efficient.

## Seed Data (MVP)

- Tenant with slug "transformlit"
- One tenant admin user + profile
- Sample groups with memberships
- Sample announcements (published and scheduled)
- Sample documents and access grants
