"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  fetchGroups,
  Group,
  searchGroups,
  updateGroup,
} from "../../../lib/api";
import {
  Button,
  Input,
  Select,
  Textarea,
} from "../../../components/FormFields";
import { Modal } from "../../../components/Modal";

type GroupVisibility = "private" | "public";

type GroupFormValues = {
  name: string;
  description?: string | null;
  visibility: GroupVisibility;
};

type AddMemberFormValues = {
  groupId: string;
  userId: string;
};

const emptyToUndefined = (value: string | undefined | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const groupSchema: yup.ObjectSchema<GroupFormValues> = yup
  .object({
    name: yup.string().trim().required("Group name is required"),
    description: yup
      .string()
      .transform((currentValue: string) => emptyToUndefined(currentValue))
      .notRequired(),
    visibility: yup
      .mixed<GroupVisibility>()
      .oneOf(["private", "public"])
      .required("Visibility is required"),
  })
  .required();

const addMemberSchema: yup.ObjectSchema<AddMemberFormValues> = yup
  .object({
    groupId: yup.string().trim().required("Select a group"),
    userId: yup.string().trim().required("User ID is required"),
  })
  .required();

const defaultGroupFormValues: GroupFormValues = {
  name: "",
  description: "",
  visibility: "private",
};

const defaultAddMemberFormValues: AddMemberFormValues = {
  groupId: "",
  userId: "",
};

export default function GroupsPage() {
  const [query, setQuery] = useState("");
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const queryClient = useQueryClient();

  const { data: groups } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: fetchGroups,
  });

  const search = useQuery({
    queryKey: ["groups", "search", query],
    queryFn: () => searchGroups(query),
    enabled: query.trim().length > 0,
  });

  const createMutation = useMutation({
    mutationFn: (payload: GroupFormValues) =>
      createGroup({
        name: payload.name,
        description: emptyToUndefined(payload.description),
        visibility: payload.visibility,
      }),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { name?: string; description?: string; visibility?: string };
    }) => updateGroup(id, payload),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGroup(id),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: AddMemberFormValues) =>
      addGroupMember(groupId, { userId }),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const groupForm = useForm<GroupFormValues>({
    resolver: yupResolver(groupSchema),
    defaultValues: defaultGroupFormValues,
  });

  const addMemberForm = useForm<AddMemberFormValues>({
    resolver: yupResolver(addMemberSchema),
    defaultValues: defaultAddMemberFormValues,
  });

  useEffect(() => {
    if (isGroupModalOpen && editingGroup) {
      groupForm.reset({
        name: editingGroup.name,
        description: editingGroup.description ?? "",
        visibility: editingGroup.visibility as GroupVisibility,
      });
      return;
    }

    if (isGroupModalOpen) {
      groupForm.reset(defaultGroupFormValues);
    }
  }, [editingGroup, groupForm, isGroupModalOpen]);

  const list = useMemo(
    () => (query.trim().length > 0 ? (search.data ?? []) : (groups ?? [])),
    [groups, query, search.data],
  );

  const onSubmitGroup = groupForm.handleSubmit((values: GroupFormValues) => {
    const payload = {
      name: values.name.trim(),
      description: emptyToUndefined(values.description),
      visibility: values.visibility,
    };

    if (editingGroup) {
      updateMutation.mutate({ id: editingGroup.id, payload });
      setEditingGroup(null);
      groupForm.reset(defaultGroupFormValues);
      setIsGroupModalOpen(false);
      return;
    }

    createMutation.mutate(payload);
    groupForm.reset(defaultGroupFormValues);
    setIsGroupModalOpen(false);
  });

  const onSubmitAddMember = addMemberForm.handleSubmit(
    (values: AddMemberFormValues) => {
      addMemberMutation.mutate({
        groupId: values.groupId,
        userId: values.userId.trim(),
      });
      addMemberForm.reset(defaultAddMemberFormValues);
    },
  );

  const handleEditGroup = (group: Group) => {
    setEditingGroup(group);
    setIsGroupModalOpen(true);
  };

  const handleCancelEdit = () => {
    setEditingGroup(null);
    groupForm.reset(defaultGroupFormValues);
    setIsGroupModalOpen(false);
  };

  const handleOpenCreateGroup = () => {
    setEditingGroup(null);
    groupForm.reset(defaultGroupFormValues);
    setIsGroupModalOpen(true);
  };

  const handleCloseGroupModal = () => {
    setEditingGroup(null);
    groupForm.reset(defaultGroupFormValues);
    setIsGroupModalOpen(false);
  };

  const handleDeleteGroup = (group: Group) => {
    if (!window.confirm(`Delete group "${group.name}"?`)) return;
    deleteMutation.mutate(group.id);
  };

  const handleBeginAddMember = (group: Group) => {
    addMemberForm.reset({
      groupId: group.id,
      userId: "",
    });
  };

  const groupOptions = (groups ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => ({ value: group.id, label: group.name }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Groups</h1>
          <p className="text-sm text-ink-soft">
            Create, edit, and manage group membership.
          </p>
        </div>

        <Button type="button" onClick={handleOpenCreateGroup}>
          Add Group
        </Button>
      </div>

      <Modal
        open={isGroupModalOpen}
        onOpenChange={(open: boolean) => {
          if (open) {
            setIsGroupModalOpen(true);
            return;
          }

          handleCloseGroupModal();
        }}
        title={editingGroup ? "Edit Group" : "Add Group"}
        description={
          editingGroup
            ? "Update name, description, and visibility."
            : "Create a new group and set its visibility."
        }
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={handleCloseGroupModal}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="group-form"
              loading={
                groupForm.formState.isSubmitting ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {editingGroup ? "Save Changes" : "Create Group"}
            </Button>
          </>
        }
      >
        <form id="group-form" onSubmit={onSubmitGroup} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <Input
              label="Group name"
              placeholder="Reading Circle"
              error={groupForm.formState.errors.name?.message}
              {...groupForm.register("name")}
            />

            <Select
              label="Visibility"
              error={groupForm.formState.errors.visibility?.message}
              options={[
                { value: "private", label: "Private" },
                { value: "public", label: "Public" },
              ]}
              {...groupForm.register("visibility")}
            />
          </div>

          <Textarea
            label="Description"
            placeholder="What is this group for?"
            error={groupForm.formState.errors.description?.message}
            rows={4}
            {...groupForm.register("description")}
          />
        </form>
      </Modal>

      <div className="rounded-2xl border border-ink/10 bg-paper p-6">
        <form
          onSubmit={(event) => event.preventDefault()}
          className="space-y-4"
        >
          <Input
            label="Search groups"
            placeholder="Search groups"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>

        <div className="mt-5 space-y-3">
          {list.length > 0 ? (
            <ul className="space-y-3">
              {list.map((group) => (
                <li
                  key={group.id}
                  className="rounded-2xl border border-ink/10 bg-paper-warm p-4 shadow-[0_2px_12px_rgba(17,17,17,0.08)]"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold text-ink">
                          {group.name}
                        </h2>
                        <span className="rounded-full border border-ink/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
                          {group.visibility}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">
                        {group.description ?? "No description provided."}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleBeginAddMember(group)}
                      >
                        Add Member
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditGroup(group)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteGroup(group)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No groups yet.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-ink/10 bg-paper p-6">
        <form onSubmit={onSubmitAddMember} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <Select
              label="Group"
              placeholderOption="Select a group"
              options={groupOptions}
              error={addMemberForm.formState.errors.groupId?.message}
              {...addMemberForm.register("groupId")}
            />
            <Input
              label="User ID"
              placeholder="Paste a user ID"
              error={addMemberForm.formState.errors.userId?.message}
              {...addMemberForm.register("userId")}
            />
          </div>

          <Button
            type="submit"
            loading={
              addMemberForm.formState.isSubmitting ||
              addMemberMutation.isPending
            }
          >
            Add Member
          </Button>
        </form>
      </div>
    </div>
  );
}
