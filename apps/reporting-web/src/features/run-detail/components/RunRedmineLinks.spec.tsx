import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';
import { RunRedmineLinks } from './RunRedmineLinks';

/**
 * The point of this card is that a run stops silently losing its bug report. Two rendering
 * rules carry that: a ticket filed from another run reproducing the same defect must still be
 * visible (otherwise the same bug gets filed twice), and it must be distinguishable from one
 * filed here (otherwise it reads as though this run was already reported when it wasn't).
 */

type Link = NonNullable<TestRunDetailResponseDto['redmine_links']>[number];

function makeLink(overrides: Partial<Link> = {}): Link {
  return {
    id: '1',
    redmine_issue_id: 100,
    redmine_url: 'https://redmine.example.com/issues/100',
    redmine_project: 'shop',
    link_type: 'created_from_run',
    created_from_this_run: true,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RunRedmineLinks', () => {
  it('renders nothing when the run has no tickets', () => {
    const { container } = render(<RunRedmineLinks links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links each ticket to its Redmine issue', () => {
    render(<RunRedmineLinks links={[makeLink()]} />);

    expect(screen.getByText('Redmine Tickets (1)')).toBeInTheDocument();
    expect(screen.getByText('Redmine #100').closest('a')).toHaveAttribute(
      'href',
      'https://redmine.example.com/issues/100',
    );
  });

  it('shows a ticket filed from another run and explains where it came from', () => {
    render(
      <RunRedmineLinks
        links={[makeLink({ id: '2', redmine_issue_id: 200, created_from_this_run: false })]}
      />,
    );

    expect(screen.getByText('Redmine #200')).toBeInTheDocument();
    expect(
      screen.getByText(/filed from another run with the same defect/i),
    ).toBeInTheDocument();
  });

  it('omits the provenance note when every ticket was filed from this run', () => {
    render(<RunRedmineLinks links={[makeLink()]} />);

    expect(
      screen.queryByText(/filed from another run with the same defect/i),
    ).not.toBeInTheDocument();
  });

  it('degrades a ticket with no stored URL to a non-navigating chip', () => {
    render(<RunRedmineLinks links={[makeLink({ redmine_url: null })]} />);

    expect(screen.getByText('Redmine #100').closest('a')).toBeNull();
  });
});
