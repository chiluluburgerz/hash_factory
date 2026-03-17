import * as React from "react"; 
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/base/button.variants";

const Button = React.forwardRef(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      ref={ref}
      type={type ?? (asChild ? undefined : "button")}
      {...props}
    />
  );
});
Button.displayName = "Button";

export { Button };
