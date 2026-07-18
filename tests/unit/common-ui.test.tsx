// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../../src/renderer/src/components/ui/Button'
import { StatusBadge } from '../../src/renderer/src/components/ui/StatusBadge'
import { SurfaceCard } from '../../src/renderer/src/components/ui/SurfaceCard'
import { EmptyState } from '../../src/renderer/src/components/feedback/EmptyState'
import { InlineNotice } from '../../src/renderer/src/components/feedback/InlineNotice'
import { StatusIndicator } from '../../src/renderer/src/components/feedback/StatusIndicator'
import { FieldHelp } from '../../src/renderer/src/components/help/FieldHelp'
import { PrivacyNotice } from '../../src/renderer/src/components/help/PrivacyNotice'
import { TroubleshootingDisclosure } from '../../src/renderer/src/components/help/TroubleshootingDisclosure'
import { ActionBar } from '../../src/renderer/src/components/layout/ActionBar'
import { AppShell } from '../../src/renderer/src/components/layout/AppShell'
import { PageHeader } from '../../src/renderer/src/components/layout/PageHeader'

afterEach(cleanup)

describe('common UI semantics', () => {
  it('exposes visual variants without changing native button behavior', () => {
    render(
      <Button variant="danger" disabled name="delete">
        삭제
      </Button>,
    )

    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'danger')
    expect(screen.getByRole('button')).toHaveAttribute('name', 'delete')
    expect(screen.getByRole('button').querySelector('svg')).toBeNull()
  })

  it('adds a decorative icon without changing the button name or click behavior', () => {
    const onClick = vi.fn()
    render(<Button icon="save" onClick={onClick}>저장</Button>)

    const button = screen.getByRole('button', { name: '저장' })
    const icon = button.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('focusable', 'false')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders cards as labelled sections by default', () => {
    render(
      <SurfaceCard labelledBy="card-heading" className="meeting-card">
        <h2 id="card-heading">회의</h2>
      </SurfaceCard>,
    )

    const card = screen.getByRole('region', { name: '회의' })
    expect(card.tagName).toBe('SECTION')
    expect(card).toHaveClass('surface-card', 'meeting-card')
  })

  it('renders the supported article card element without changing its label', () => {
    render(
      <SurfaceCard as="article" labelledBy="article-heading">
        <h2 id="article-heading">최근 기록</h2>
      </SurfaceCard>,
    )

    expect(screen.getByRole('article', { name: '최근 기록' })).toBeVisible()
  })

  it('exposes badge and availability state through stable data attributes', () => {
    render(
      <>
        <StatusBadge label="완료" tone="success" icon="success" />
        <StatusIndicator available>Codex 사용 가능</StatusIndicator>
      </>,
    )

    expect(screen.getByText('완료')).toHaveAttribute('data-tone', 'success')
    expect(screen.getByText('완료').querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Codex 사용 가능')).toHaveAttribute('data-available', 'true')
  })

  it('labels privacy notices and only renders troubleshooting when supplied', () => {
    const { rerender } = render(
      <InlineNotice tone="privacy" title="클라우드 처리">
        대화 내용이 전송됩니다.
      </InlineNotice>,
    )
    expect(screen.getByRole('note', { name: '클라우드 처리' })).toBeVisible()
    rerender(<TroubleshootingDisclosure title="문제 해결" steps={null} />)
    expect(screen.queryByRole('region', { name: '문제 해결' })).not.toBeInTheDocument()
    rerender(
      <TroubleshootingDisclosure title="문제 해결" steps={['codex login', '다시 확인']} />,
    )
    expect(screen.getByRole('region', { name: '문제 해결' })).toHaveTextContent('codex login')
  })

  it('uses an alert for errors and composes the privacy notice', () => {
    render(
      <>
        <InlineNotice tone="error" title="저장 실패">
          다시 시도하세요.
        </InlineNotice>
        <PrivacyNotice title="로컬 처리">오디오는 이 기기를 벗어나지 않습니다.</PrivacyNotice>
      </>,
    )

    expect(screen.getByRole('alert', { name: '저장 실패' })).toBeVisible()
    expect(screen.getByRole('note', { name: '로컬 처리' })).toHaveAttribute(
      'data-tone',
      'privacy',
    )
  })

  it('renders optional empty-state and field-help descriptions only when supplied', () => {
    const { rerender } = render(<EmptyState title="기록 없음" />)
    expect(screen.getByText('기록 없음')).toBeVisible()
    expect(document.querySelector('.empty-state p')).not.toBeInTheDocument()

    rerender(
      <>
        <EmptyState title="기록 없음" description="첫 회의를 녹음하세요." />
        <FieldHelp>앞으로 시작하는 처리에 적용됩니다.</FieldHelp>
      </>,
    )
    expect(screen.getByText('첫 회의를 녹음하세요.')).toBeVisible()
    expect(screen.getByText('앞으로 시작하는 처리에 적용됩니다.')).toHaveClass('field-help')
  })

  it('separates danger actions in the action bar', () => {
    render(
      <ActionBar danger={<Button variant="danger">삭제</Button>}>
        <Button variant="primary">저장</Button>
      </ActionBar>,
    )

    expect(screen.getByRole('button', { name: '저장' })).toHaveAttribute('data-variant', 'primary')
    expect(screen.getByRole('button', { name: '삭제' }).parentElement).toHaveClass(
      'action-bar-danger',
    )
  })

  it('renders app navigation and reports native navigation actions', () => {
    const onNavigate = vi.fn()
    render(
      <AppShell active="templates" onNavigate={onNavigate}>
        <main>콘텐츠</main>
      </AppShell>,
    )

    const navigation = screen.getByRole('navigation', { name: '주요 메뉴' })
    expect(within(navigation).getByRole('button', { name: '요약 템플릿' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    for (const name of ['전체 기록', '요약 템플릿', '설정']) {
      expect(within(navigation).getByRole('button', { name }).querySelector('.ui-icon')).toBeVisible()
    }
    expect(within(navigation).queryByRole('button', { name: /가져오기/ })).not.toBeInTheDocument()
    const brand = screen.getByRole('button', { name: 'Mineloa 홈' })
    expect(brand).toHaveTextContent('Mineloa')
    expect(brand.querySelector('.brand-mark')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(brand)
    expect(onNavigate).toHaveBeenCalledWith('all')
  })

  it('connects page header actions and its forwarded heading ref', () => {
    const headingRef = createRef<HTMLHeadingElement>()
    const onBack = vi.fn()
    render(
      <PageHeader
        ref={headingRef}
        eyebrow="SETTINGS"
        title="설정"
        description="처리 방식을 관리합니다."
        backLabel="전체 기록"
        onBack={onBack}
        trailing={<StatusBadge label="활성" tone="active" />}
      />,
    )

    expect(headingRef.current).toBe(screen.getByRole('heading', { name: '설정' }))
    expect(headingRef.current).toHaveAttribute('tabindex', '-1')
    const back = screen.getByRole('button', { name: '전체 기록' })
    expect(back.querySelector('.ui-icon')).toBeVisible()
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
    expect(screen.getByText('활성')).toHaveAttribute('data-tone', 'active')
  })

  it('keeps shared controls and surfaces on the common design tokens', () => {
    const globals = readFileSync('src/renderer/src/styles/globals.css', 'utf8')
    const app = readFileSync('src/renderer/src/styles/app.css', 'utf8')

    expect(globals).toMatch(/\.ui-button[^}]*min-height:\s*48px/s)
    expect(globals).toMatch(/\.ui-button[^}]*border-radius:\s*var\(--radius-control\)/s)
    expect(globals).toMatch(/\.ui-button\[data-variant='primary'\][^}]*var\(--action-primary-surface\)/s)
    expect(app).toMatch(/\.surface-card[^}]*border:\s*1px solid var\(--hairline\)/s)
    expect(app).toMatch(/\.surface-card[^}]*border-radius:\s*var\(--radius-card\)/s)
    expect(app).toContain('.inline-notice')
    expect(app).toContain('.troubleshooting')
  })

  it('keeps legacy feature primary and danger actions visually distinct until migration', () => {
    const globals = readFileSync('src/renderer/src/styles/globals.css', 'utf8')

    expect(globals).toMatch(
      /\.ui-button\[data-variant='primary'\],\s*\.button-primary\s*\{[^}]*var\(--action-primary-surface\)/s,
    )
    expect(globals).toMatch(
      /\.button-primary:hover:not\(:disabled\),\s*\.button-primary:active:not\(:disabled\)\s*\{[^}]*var\(--action-primary-surface-hover\)/s,
    )
    expect(globals).toMatch(
      /\.ui-button\[data-variant='danger'\],\s*\.button-danger\s*\{[^}]*var\(--danger\)/s,
    )
  })
})
