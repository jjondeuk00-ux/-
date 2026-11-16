interface HeaderProps {
  rightAction?: { label: string; onClick?: () => void };
}

export default function Header({ rightAction }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 h-[50px] bg-white border-b border-gray-border">
      <div className="flex items-center gap-2">
        <div className="w-[30px] h-[30px] rounded-full bg-green-primary flex items-center justify-center">
          <span className="text-white text-sm font-bold leading-none">꼬</span>
        </div>
        <span className="text-lg font-bold text-gray-text">꼬집</span>
      </div>
      {rightAction && (
        <button
          onClick={rightAction.onClick}
          className="text-[13px] text-gray-secondary"
        >
          {rightAction.label}
        </button>
      )}
    </header>
  );
}
