import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
};

export function ComingSoon({ icon: Icon, title, description }: Props) {
  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <Card>
        <CardContent className="p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Icon className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight mt-5">{title}</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">{description}</p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
