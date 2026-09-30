import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockAddToast = jest.fn();
const mockResolveImageUrl = jest.fn();
const mockUploadImage = jest.fn();
const mockUpdateGroup = jest.fn();
const mockDeleteGroup = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

jest.mock('../../lib/groups', () => ({
  resolveImageUrl: (...args: unknown[]) => mockResolveImageUrl(...args),
  uploadImage: (...args: unknown[]) => mockUploadImage(...args),
  updateGroup: (...args: unknown[]) => mockUpdateGroup(...args),
  deleteGroup: (...args: unknown[]) => mockDeleteGroup(...args),
}));

import { GroupSettings } from './group-settings';

const baseGroup = {
  id: 'g1',
  name: 'Sci-Fi Readers',
  slug: 'sci-fi-readers',
  description: 'A group about books',
  visibility: 'PUBLIC',
  category: 'BIBLICAL_STUDIES',
  coverImageUrl: null,
  featured: false,
  memberCount: 12,
  myRole: 'OWNER',
  myStatus: 'ACTIVE',
  createdAt: '2025-01-01T00:00:00Z',
};

function renderSettings(group = baseGroup) {
  const onChanged = jest.fn();
  const view = render(<GroupSettings group={group} onChanged={onChanged} />);
  return { ...view, onChanged };
}

function coverInput() {
  return screen.getByLabelText('Cover image') as HTMLInputElement;
}

describe('GroupSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveImageUrl.mockReturnValue(undefined);
    mockUpdateGroup.mockResolvedValue({ id: 'g1' });
    mockDeleteGroup.mockResolvedValue(undefined);
    mockUploadImage.mockResolvedValue('uploads/new-cover.png');
  });

  it('renders the form defaults and a placeholder when there is no cover', () => {
    renderSettings();

    expect(screen.getByDisplayValue('Sci-Fi Readers')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A group about books')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Public')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Biblical Studies')).toBeInTheDocument();
    expect(screen.queryByAltText('Group cover')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('renders the existing cover image when one is resolvable', () => {
    mockResolveImageUrl.mockReturnValue('http://cdn.example/cover.png');
    renderSettings();

    expect(screen.getByAltText('Group cover')).toHaveAttribute(
      'src',
      'http://cdn.example/cover.png',
    );
  });

  it('submits the trimmed values and notifies the parent on success', async () => {
    const { onChanged } = renderSettings();

    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: '  Renamed Group  ' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  Updated description  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith('g1', {
        name: 'Renamed Group',
        description: 'Updated description',
        visibility: 'PUBLIC',
        category: 'BIBLICAL_STUDIES',
        coverImageUrl: undefined,
      });
    });

    expect(mockAddToast).toHaveBeenCalledWith('Group settings saved.', 'success');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('sends the trimmed values when the user clears the description', async () => {
    mockResolveImageUrl.mockReturnValue(undefined);
    renderSettings();

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ description: '' }),
      );
    });
  });

  it('blocks submission and shows a validation error for a short name', async () => {
    renderSettings();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      await screen.findByText('Group name must be at least 2 characters'),
    ).toBeInTheDocument();
    expect(mockUpdateGroup).not.toHaveBeenCalled();
  });

  it('shows an error toast when saving fails', async () => {
    mockUpdateGroup.mockRejectedValueOnce(new Error('nope'));
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Failed to save settings.', 'error');
    });
  });

  it('uploads a cover image and shows the new preview on success', async () => {
    mockResolveImageUrl.mockImplementation((key?: string | null) =>
      key ? `http://cdn.example/${key}` : undefined,
    );
    renderSettings();

    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    fireEvent.change(coverInput(), { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUploadImage).toHaveBeenCalledWith(file);
      expect(mockAddToast).toHaveBeenCalledWith('Cover image uploaded.', 'success');
    });

    expect(screen.getByAltText('Group cover')).toHaveAttribute(
      'src',
      'http://cdn.example/uploads/new-cover.png',
    );
  });

  it('includes the uploaded cover key in the save payload', async () => {
    renderSettings();

    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    fireEvent.change(coverInput(), { target: { files: [file] } });

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith('Cover image uploaded.', 'success'),
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ coverImageUrl: 'uploads/new-cover.png' }),
      );
    });
  });

  it('shows an error toast when the cover upload fails', async () => {
    mockUploadImage.mockRejectedValueOnce(new Error('upload failed'));
    renderSettings();

    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    fireEvent.change(coverInput(), { target: { files: [file] } });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Cover upload failed. Please try again.',
        'error',
      );
    });
  });

  it('opens the hidden file picker from the upload button', () => {
    const clickSpy = jest
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /upload new image/i }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('ignores a change event with no selected file', () => {
    renderSettings();

    fireEvent.change(coverInput(), { target: { files: [] } });

    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('disables the upload button while an upload is in flight', async () => {
    let resolveUpload: (value: string) => void = () => undefined;
    mockUploadImage.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    renderSettings();

    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    fireEvent.change(coverInput(), { target: { files: [file] } });

    const uploadingButton = await screen.findByRole('button', { name: /uploading/i });
    expect(uploadingButton).toBeDisabled();

    resolveUpload('uploads/done.png');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /upload new image/i })).toBeEnabled(),
    );
  });

  it('deletes the group and redirects after confirmation', async () => {
    globalThis.window.confirm = jest.fn(() => true);
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /delete group/i }));

    await waitFor(() => {
      expect(mockDeleteGroup).toHaveBeenCalledWith('g1');
      expect(mockAddToast).toHaveBeenCalledWith('Group deleted.', 'info');
      expect(mockPush).toHaveBeenCalledWith('/groups');
    });
  });

  it('does not delete when the confirmation is cancelled', () => {
    globalThis.window.confirm = jest.fn(() => false);
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /delete group/i }));

    expect(mockDeleteGroup).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows an error toast when deletion fails', async () => {
    globalThis.window.confirm = jest.fn(() => true);
    mockDeleteGroup.mockRejectedValueOnce(new Error('nope'));
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /delete group/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Failed to delete group.', 'error');
    });
  });

  it('defaults visibility to PRIVATE and falls back to the first category', () => {
    renderSettings({
      ...baseGroup,
      visibility: 'PRIVATE',
      category: undefined as unknown as string,
      description: undefined as unknown as string,
    });

    expect(screen.getByDisplayValue('Private')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Biblical Studies')).toBeInTheDocument();
  });
});
