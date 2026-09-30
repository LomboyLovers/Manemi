import AddButton from "./Add_Button";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AddButton />
    </>
  );
}